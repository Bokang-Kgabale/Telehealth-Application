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
let pendingCalleeCandidates = []; // Added for ICE candidate queueing
let pendingCallerCandidates = []; // Added for ICE candidate queueing

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
remoteVideo.srcObject = remoteStream;

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

// Request user media
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

async function startVideoCall() {
  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
    }

    // Create peer connection first
    peerConnection = new RTCPeerConnection(iceServers);
    remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    // Add tracks
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    // Event handlers
    peerConnection.ontrack = event => {
      event.streams[0].getTracks().forEach(track => {
        remoteStream.addTrack(track);
      });
      console.log("Remote stream received.");
    };

    // ICE candidate handling
    const pendingCandidates = [];
    let remoteDescriptionSet = false;

    peerConnection.onicecandidate = event => {
      if (event.candidate && roomId) {
        db.collection("rooms").doc(roomId).collection("callerCandidates").add(event.candidate.toJSON())
          .then(() => console.log("Caller ICE candidate sent."))
          .catch(e => console.error("Error sending candidate:", e));
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log("ICE connection state:", peerConnection.iceConnectionState);
    };

    // Create room
    const roomRef = await db.collection("rooms").add({});
    roomId = roomRef.id;
    window.currentRoom = roomId;
    document.getElementById("currentRoom").innerText = `Room ID: ${roomId}`;
    document.getElementById("hangUp").disabled = false;

    // Create and send offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await roomRef.update({
      offer: {
        type: offer.type,
        sdp: offer.sdp
      }
    });

    // Answer listener with proper state management
    roomRef.onSnapshot(async snapshot => {
      const data = snapshot.data();
      if (data?.answer && !remoteDescriptionSet) {
        try {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
          console.log("Remote description set with answer.");
          remoteDescriptionSet = true;
          
          // Process any queued candidates
          for (const candidate of pendingCandidates) {
            try {
              await peerConnection.addIceCandidate(candidate);
              console.log("Added queued candidate.");
            } catch (e) {
              console.error("Error adding queued candidate:", e);
            }
          }
        } catch (error) {
          console.error("Error setting remote description:", error);
        }
      }
    });

    // Callee candidates listener with queueing
    roomRef.collection("calleeCandidates").onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          if (remoteDescriptionSet) {
            peerConnection.addIceCandidate(candidate)
              .then(() => console.log("Added callee candidate."))
              .catch(e => console.warn("Error adding callee candidate:", e));
          } else {
            console.log("Queuing candidate until remote description is set");
            pendingCandidates.push(candidate);
          }
        }
      });
    });

  } catch (error) {
    console.error("Error starting video call:", error);
    alert("Failed to start video call. Please check your media device access and internet.");
  }
}

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

    // Process queued candidates after setting remote description
    pendingCallerCandidates.forEach(async candidate => {
      try {
        await peerConnection.addIceCandidate(candidate);
        console.log("Added queued caller candidate.");
      } catch (e) {
        console.error("Error adding queued caller candidate:", e);
      }
    });
    pendingCallerCandidates = [];

    const roomWithAnswer = {
      answer: {
        type: answer.type,
        sdp: answer.sdp
      }
    };

    await roomRef.update(roomWithAnswer);
    console.log("Answer sent to Firestore.");

    roomRef.collection("callerCandidates").onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          if (peerConnection.currentRemoteDescription) {
            peerConnection.addIceCandidate(candidate).then(() => {
              console.log("Added caller candidate.");
            }).catch(e => console.warn("Error adding caller candidate:", e));
          } else {
            console.log("Queuing caller candidate until remote description is set.");
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

  // Clear pending candidates queues
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