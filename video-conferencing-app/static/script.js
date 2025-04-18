// Firebase configuration (unchanged)
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

// Global variables (added candidate queues)
let db;
let localStream;
let remoteStream = new MediaStream();
let peerConnection;
let roomId;
let pendingCalleeCandidates = [];
let pendingCallerCandidates = [];

// DOM elements (unchanged)
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
remoteVideo.srcObject = remoteStream;

// ICE servers (unchanged)
const iceServers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:relay.metered.ca:443",
      username: "openai",
      credential: "openai123"
    }
  ]
};

// initializeVideoCall (unchanged)
function initializeVideoCall() {
  console.log("Video call initialized");
  navigator.permissions.query({ name: "camera" }).then(permissionStatus => {
    if (permissionStatus.state === "granted") {
      openUserMedia();
    } else {
      console.log("Camera permission not yet granted. Waiting for user interaction.");
    }
  }).catch(err => {
    console.warn("Permission API not supported or error:", err);
    openUserMedia();
  });
}

// openUserMedia (unchanged)
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
    alert("Unable to access camera and microphone. Please allow permissions and try again.");
  }
}

// MODIFIED: startVideoCall with candidate queueing
async function startVideoCall() {
  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
    }

    peerConnection = new RTCPeerConnection(iceServers);
    remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = event => {
      event.streams[0].getTracks().forEach(track => {
        remoteStream.addTrack(track);
      });
      console.log("Remote stream received.");
    };

    peerConnection.onicecandidate = event => {
      if (event.candidate && roomId) {
        db.collection("rooms").doc(roomId).collection("callerCandidates").add(event.candidate.toJSON());
        console.log("Caller ICE candidate sent.");
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log("ICE connection state:", peerConnection.iceConnectionState);
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const roomWithOffer = {
      offer: {
        type: offer.type,
        sdp: offer.sdp
      }
    };

    let roomRef;
    if (roomId) {
      roomRef = db.collection("rooms").doc(roomId);
      await roomRef.set(roomWithOffer, { merge: true });
    } else {
      roomRef = await db.collection("rooms").add(roomWithOffer);
      roomId = roomRef.id;
    }

    window.currentRoom = roomId;
    document.getElementById("currentRoom").innerText = `Room ID: ${roomId}`;
    document.getElementById("hangUp").disabled = false;

    roomRef.onSnapshot(async snapshot => {
      const data = snapshot.data();
      if (data?.answer && !peerConnection.currentRemoteDescription) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        console.log("Remote description set with answer.");
        
        // Process any queued candidates
        pendingCalleeCandidates.forEach(candidate => {
          peerConnection.addIceCandidate(candidate)
            .then(() => console.log("Added queued callee candidate."))
            .catch(e => console.error("Error adding queued candidate:", e));
        });
        pendingCalleeCandidates = [];
      }
    });

    roomRef.collection("calleeCandidates").onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          if (peerConnection.currentRemoteDescription) {
            peerConnection.addIceCandidate(candidate)
              .then(() => console.log("Added callee candidate."))
              .catch(e => console.warn("Error adding callee candidate:", e));
          } else {
            console.log("Queuing callee candidate (will add when ready)");
            pendingCalleeCandidates.push(candidate);
          }
        }
      });
    });

  } catch (error) {
    console.error("Error starting video call:", error);
    alert("Failed to start video call. Please check your media device access and internet.");
  }
}

// MODIFIED: joinRoom with candidate queueing
async function joinRoom(roomIdInput) {
  try {
    const roomRef = db.collection("rooms").doc(roomIdInput);
    const roomSnapshot = await roomRef.get();

    if (!roomSnapshot.exists) {
      alert("The room ID you entered does not exist.");
      return;
    }

    console.log(`Joining room: ${roomIdInput}`);
    document.getElementById("currentRoom").innerText = `Room ID: ${roomIdInput}`;
    roomId = roomIdInput;

    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
    }

    peerConnection = new RTCPeerConnection(iceServers);
    remoteStream = new MediaStream();

    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = event => {
      event.streams[0].getTracks().forEach(track => {
        remoteStream.addTrack(track);
      });
      remoteVideo.srcObject = remoteStream;
      console.log("Remote track added.");
    };

    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        roomRef.collection("calleeCandidates").add(event.candidate.toJSON());
        console.log("Callee ICE candidate sent.");
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log("ICE connection state:", peerConnection.iceConnectionState);
    };

    const offer = roomSnapshot.data().offer;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    const roomWithAnswer = {
      answer: {
        type: answer.type,
        sdp: answer.sdp
      }
    };

    await roomRef.update(roomWithAnswer);
    console.log("Answer sent to Firestore.");

    // Process any queued candidates
    pendingCallerCandidates.forEach(candidate => {
      peerConnection.addIceCandidate(candidate)
        .then(() => console.log("Added queued caller candidate."))
        .catch(e => console.error("Error adding queued candidate:", e));
    });
    pendingCallerCandidates = [];

    roomRef.collection("callerCandidates").onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          if (peerConnection.currentRemoteDescription) {
            peerConnection.addIceCandidate(candidate)
              .then(() => console.log("Added caller candidate."))
              .catch(e => console.warn("Error adding caller candidate:", e));
          } else {
            console.log("Queuing caller candidate (will add when ready)");
            pendingCallerCandidates.push(candidate);
          }
        }
      });
    });

    document.getElementById("hangUp").disabled = false;

  } catch (error) {
    console.error("Error joining room:", error);
    alert("Failed to join the room. Check your Room ID or connection.");
  }
}

// MODIFIED: hangUp with queue cleanup
async function hangUp() {
  console.log("Hanging up the call...");

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
  }

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
    console.log("Peer connection closed.");
  }

  // Clear pending candidates
  pendingCalleeCandidates = [];
  pendingCallerCandidates = [];

  localVideo.srcObject = null;
  remoteVideo.srcObject = null;

  document.getElementById("currentRoom").innerText = "";
  document.getElementById("startCall").disabled = true;
  document.getElementById("joinCall").disabled = true;
  document.getElementById("hangUp").disabled = true;
  document.getElementById("muteAudio").disabled = true;
  document.getElementById("toggleVideo").disabled = true;

  console.log("Call ended and UI reset.");
  location.reload();
}

// Event listeners (unchanged)
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("openMedia").onclick = openUserMedia;
  document.getElementById("startCall").onclick = startVideoCall;
  document.getElementById("joinCall").onclick = async () => {
    const inputId = prompt("Enter Room ID:");
    if (inputId) {
      await joinRoom(inputId);
    }
  };
  document.getElementById("hangUp").onclick = hangUp;

  document.getElementById("muteAudio").onclick = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      const icon = localStream.getAudioTracks()[0].enabled
        ? '<i class="fas fa-microphone"></i>'
        : '<i class="fas fa-microphone-slash"></i>';
      document.getElementById("muteAudio").innerHTML = icon;
    }
  };

  document.getElementById("toggleVideo").onclick = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      const icon = localStream.getVideoTracks()[0].enabled
        ? '<i class="fas fa-video"></i>'
        : '<i class="fas fa-video-slash"></i>';
      document.getElementById("toggleVideo").innerHTML = icon;
    }
  };
});