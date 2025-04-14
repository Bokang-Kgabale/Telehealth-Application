// Firebase configuration
fetch('/firebase-config')
  .then(res => res.json())
  .then(config => {
    // Initialize Firebase with the fetched configuration
    firebase.initializeApp(config);
    db = firebase.firestore(); // ✅ Assign db here
    console.log("Firebase initialized successfully.");

    // Now that Firebase is initialized, proceed with the rest of the setup
    initializeVideoCall(); // ✅ Defined already
  })
  .catch(error => {
    console.error("Error loading Firebase configuration:", error);
    alert("Failed to load Firebase configuration.");
  });

// ✅ Global variables
let db;
let localStream; // ✅ Declare globally
let remoteStream = new MediaStream();
let peerConnection;
let roomId; // To track the current room

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
remoteVideo.srcObject = remoteStream;

const iceServers = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302"
    }
  ]
};

async function getBuiltInCamera() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const builtInCamera = devices.find(device => 
    device.kind === 'videoinput' && 
    device.label.toLowerCase().includes('built-in')
  );
  return builtInCamera ? { deviceId: builtInCamera.deviceId } : true;
}

async function openUserMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    document.getElementById("startCall").disabled = false;
    document.getElementById("joinCall").disabled = false;
    console.log("User media opened:", localStream);
  } catch (error) {
    console.error("Error accessing media devices:", error);
    alert("Unable to access camera and microphone. Please check your permissions.");
  }
}
// Define initializeVideoCall BEFORE calling it
function initializeVideoCall() {
  console.log("Video call initialized");
  // TODO: Add your video call setup logic here
}
// Start a video call
async function startVideoCall() {
  try {
    console.log("Starting video call...");

    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
    }

    peerConnection = new RTCPeerConnection(iceServers);

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = event => {
      event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    };

    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        db.collection("rooms").doc(roomId).collection("callerCandidates").add(event.candidate.toJSON());
      }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const roomWithOffer = {
      offer: {
        type: offer.type,
        sdp: offer.sdp
      }
    };
    const roomRef = await db.collection("rooms").add(roomWithOffer);
    roomId = roomRef.id;

    window.currentRoom = roomId;

    console.log(`Room created with ID: ${roomId}`);
    document.getElementById("currentRoom").innerText = `Room ID: ${roomId}`;
    document.getElementById("hangUp").disabled = false;

    roomRef.onSnapshot(async snapshot => {
      const data = snapshot.data();
      if (data?.answer && !peerConnection.currentRemoteDescription) {
        const answer = new RTCSessionDescription(data.answer);
        await peerConnection.setRemoteDescription(answer);
      }
    });

    roomRef.collection("calleeCandidates").onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          peerConnection.addIceCandidate(candidate);
        }
      });
    });
  } catch (error) {
    console.error("Error starting video call:", error);
  }
}

// Join an existing room
async function joinRoom(roomId) {
  try {
    const roomRef = db.collection("rooms").doc(roomId);
    const roomSnapshot = await roomRef.get();

    if (!roomSnapshot.exists) {
      console.error("Room does not exist!");
      return;
    }

    console.log(`Joining room: ${roomId}`);
    document.getElementById("currentRoom").innerText = `Room ID: ${roomId}`;

    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
    }

    peerConnection = new RTCPeerConnection(iceServers);

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = event => {
      event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    };

    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        roomRef.collection("calleeCandidates").add(event.candidate.toJSON());
      }
    };

    const offer = roomSnapshot.data().offer;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    const roomWithAnswer = { answer: { type: answer.type, sdp: answer.sdp } };
    await roomRef.update(roomWithAnswer);

    roomRef.collection("callerCandidates").onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          peerConnection.addIceCandidate(candidate);
        }
      });
    });
  } catch (error) {
    console.error("Error joining room:", error);
  }
}

// Hang up the call
async function hangUp() {
  console.log("Hanging up the call...");

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
    remoteStream = null;
  }

  localVideo.srcObject = null;
  remoteVideo.srcObject = null;

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
    console.log("Peer connection closed.");
  }

  document.getElementById("currentRoom").innerText = "";
  document.getElementById("startCall").disabled = true;
  document.getElementById("joinCall").disabled = true;
  document.getElementById("hangUp").disabled = true;

  console.log("Call ended and UI reset.");

  location.reload();
}

// Event listeners
document.getElementById("openMedia").onclick = openUserMedia;
document.getElementById("startCall").onclick = startVideoCall;
document.getElementById("joinCall").onclick = async () => {
  const roomId = prompt("Enter Room ID:");
  if (roomId) {
    await joinRoom(roomId);
  }
};
document.getElementById("hangUp").onclick = hangUp;
