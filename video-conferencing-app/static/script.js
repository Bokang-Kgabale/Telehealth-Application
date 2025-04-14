// Firebase configuration
fetch('/firebase-config')
  .then(res => res.json())
  .then(config => {
    firebase.initializeApp(config);
    db = firebase.firestore();
    console.log("Firebase initialized successfully.");
    initializeVideoCall();
  })
  .catch(error => {
    console.error("Error loading Firebase configuration:", error);
    alert("Failed to load Firebase configuration.");
  });

// Global variables
let db;
let localStream;
let remoteStream = new MediaStream();
let peerConnection;
let roomId;

let isMuted = false;
let isCameraOff = false;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
remoteVideo.srcObject = remoteStream;

const iceServers = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function initializeVideoCall() {
  console.log("Video call initialized");
}

async function getBuiltInCamera() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const builtInCamera = devices.find(device =>
    device.kind === 'videoinput' && device.label.toLowerCase().includes('built-in')
  );
  return builtInCamera ? { deviceId: builtInCamera.deviceId } : true;
}

async function openUserMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    document.getElementById("startCall").disabled = false;
    document.getElementById("joinCall").disabled = false;
    document.getElementById("muteAudio").disabled = false;
    document.getElementById("toggleVideo").disabled = false;
    console.log("User media opened:", localStream);
  } catch (error) {
    console.error("Error accessing media devices:", error);
    alert("Unable to access camera and microphone. Please check your permissions.");
  }
}

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
  document.getElementById("muteAudio").disabled = true;
  document.getElementById("toggleVideo").disabled = true;

  console.log("Call ended and UI reset.");
  location.reload();
}

// Event listeners
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("openMedia").onclick = openUserMedia;
  document.getElementById("startCall").onclick = startVideoCall;
  document.getElementById("joinCall").onclick = async () => {
    const roomId = prompt("Enter Room ID:");
    if (roomId) {
      await joinRoom(roomId);
    }
  };
  document.getElementById("hangUp").onclick = hangUp;

  document.getElementById("muteAudio").onclick = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = isMuted;
      });
      isMuted = !isMuted;
      document.getElementById("muteAudio").innerText = isMuted ? "Unmute" : "Mute";
    }
  };

  document.getElementById("toggleVideo").onclick = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = isCameraOff;
      });
      isCameraOff = !isCameraOff;
      document.getElementById("toggleVideo").innerText = isCameraOff ? "Enable Camera" : "Disable Camera";
    }
  };
});
