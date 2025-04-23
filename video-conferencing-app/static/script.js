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
let isCaller = false;
let remoteDescriptionSet = false;
let iceCandidateBuffer = [];
let connectionTimer;
let roomRef; // Reference to the current room document

// DOM elements
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
remoteVideo.srcObject = remoteStream;

// ICE Servers configuration
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

// Constants
const MAX_CONNECTION_TIME = 10000; // 10 seconds

// Initialize video call
function initializeVideoCall() {
  console.log("Video call initialized");

  navigator.permissions?.query?.({ name: "camera" })
    .then(permissionStatus => {
      if (permissionStatus.state === "granted") {
        openUserMedia();
      } else {
        console.log("Camera permission not yet granted. Waiting for user interaction.");
      }
    })
    .catch(err => {
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

// Start a new video call
async function startVideoCall() {
  try {
    isCaller = true;
    await setupMediaStream();
    
    peerConnection = createPeerConnection();
    setupPeerConnectionListeners();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const roomWithOffer = {
      offer: {
        type: offer.type,
        sdp: offer.sdp
      }
    };

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

    // Start connection timer
    startConnectionTimer();

    // Listen for answer
    roomRef.onSnapshot(async snapshot => {
      const data = snapshot.data();
      if (data?.answer) {
        console.log("Signaling state before setRemoteDescription:", peerConnection.signalingState);
        if (!remoteDescriptionSet && (peerConnection.signalingState === "have-local-offer" || peerConnection.signalingState === "stable")) {
          try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            remoteDescriptionSet = true;
            console.log("Remote description set with answer.");
            processBufferedCandidates();
          } catch (error) {
            console.error("Error setting remote description:", error);
          }
        }
      }
    });

    // Listen for callee candidates
    roomRef.collection("calleeCandidates").onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          handleIncomingIceCandidate(candidate);
        }
      });
    });

  } catch (error) {
    console.error("Error starting video call:", error);
    alert("Failed to start video call. Please check your media device access and internet.");
  }
}

// Join an existing room
async function joinRoom(roomIdInput) {
  try {
    isCaller = false;
    roomRef = db.collection("rooms").doc(roomIdInput);
    const roomSnapshot = await roomRef.get();

    if (!roomSnapshot.exists) {
      alert("The room ID you entered does not exist.");
      return;
    }

    console.log(`Joining room: ${roomIdInput}`);
    document.getElementById("currentRoom").innerText = `Room ID: ${roomIdInput}`;
    roomId = roomIdInput;

    await setupMediaStream();
    peerConnection = createPeerConnection();
    setupPeerConnectionListeners();

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
    remoteDescriptionSet = true;

    // Start connection timer
    startConnectionTimer();

    // Listen for caller candidates
    roomRef.collection("callerCandidates").onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          handleIncomingIceCandidate(candidate);
        }
      });
    });

    document.getElementById("hangUp").disabled = false;

  } catch (error) {
    console.error("Error joining room:", error);
    alert("Failed to join the room. Check your Room ID or connection.");
  }
}

// Helper function to create peer connection
function createPeerConnection() {
  const pc = new RTCPeerConnection(iceServers);
  
  // Add local tracks
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  return pc;
}

// Helper function to setup peer connection listeners
function setupPeerConnectionListeners() {
  // Handle remote stream
  peerConnection.ontrack = event => {
    event.streams[0].getTracks().forEach(track => {
      remoteStream.addTrack(track);
    });
    remoteVideo.srcObject = remoteStream;
    console.log("Remote stream received.");
  };

  // ICE candidate handler
  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      console.log("New ICE candidate generated:", event.candidate);
      if (roomId) {
        const collectionName = isCaller ? "callerCandidates" : "calleeCandidates";
        db.collection("rooms").doc(roomId).collection(collectionName).add(event.candidate.toJSON())
          .catch(e => console.error("Error sending ICE candidate:", e));
      }
    } else {
      console.log("ICE gathering complete");
    }
  };

  // ICE connection state handler
  peerConnection.oniceconnectionstatechange = () => {
    console.log("ICE connection state changed to:", peerConnection.iceConnectionState);
    switch (peerConnection.iceConnectionState) {
      case "connected":
        console.log("ICE connection established successfully");
        clearConnectionTimer();
        break;
      case "failed":
        console.error("ICE connection failed - attempting restart...");
        // Consider implementing ICE restart
        break;
      case "disconnected":
        console.warn("ICE connection disconnected - checking network...");
        break;
    }
  };

  // Signaling state handler
  peerConnection.onsignalingstatechange = () => {
    console.log("Signaling state changed to:", peerConnection.signalingState);
    if (peerConnection.signalingState === "stable") {
      processBufferedCandidates();
    }
  };
}

// Helper function to handle incoming ICE candidates
function handleIncomingIceCandidate(candidate) {
  console.log("remoteDescriptionSet:", remoteDescriptionSet, "signalingState:", peerConnection.signalingState);
  if (remoteDescriptionSet && peerConnection.signalingState === "stable") {
    addIceCandidateSafely(candidate);
  } else {
    console.log("Buffering ICE candidate as remote description not set or signalingState not stable.");
    iceCandidateBuffer.push(candidate);
  }
}

// Helper function to safely add ICE candidates
async function addIceCandidateSafely(candidate) {
  try {
    await peerConnection.addIceCandidate(candidate);
    console.log("Successfully added ICE candidate");
    return true;
  } catch (e) {
    console.error("Error adding ICE candidate:", e);
    return false;
  }
}

// Helper function to process buffered ICE candidates
async function processBufferedCandidates() {
  if (iceCandidateBuffer.length > 0) {
    console.log(`Processing ${iceCandidateBuffer.length} buffered ICE candidates`);
    for (const candidate of iceCandidateBuffer) {
      await addIceCandidateSafely(candidate);
    }
    iceCandidateBuffer = [];
  }
}

// Helper function to setup media stream
async function setupMediaStream() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  }
}

// Connection timer functions
function startConnectionTimer() {
  clearConnectionTimer(); // Clear any existing timer
  connectionTimer = setTimeout(() => {
    if (peerConnection && 
        (peerConnection.iceConnectionState === 'checking' || 
         peerConnection.iceConnectionState === 'disconnected')) {
      console.warn("Connection taking too long - attempting recovery");
      // Implement recovery logic here if needed
    }
  }, MAX_CONNECTION_TIME);
}

function clearConnectionTimer() {
  if (connectionTimer) {
    clearTimeout(connectionTimer);
    connectionTimer = null;
  }
}

// Hang up the call
async function hangUp() {
  console.log("Hanging up the call...");
  
  // Clear the connection timer
  clearConnectionTimer();

  // Stop all media tracks
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
    remoteStream = new MediaStream(); // Reset remote stream
  }

  // Close peer connection
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
    console.log("Peer connection closed.");
  }

  // Clear any pending candidates
  iceCandidateBuffer = [];

  // Clean up Firestore listeners and data if room exists
  if (roomRef) {
    // Delete the room if we're the caller
    if (isCaller) {
      try {
        await roomRef.delete();
        console.log("Room deleted successfully");
      } catch (error) {
        console.error("Error deleting room:", error);
      }
    }
    roomRef = null;
  }

  // Clean up UI
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  
  // Reset UI elements
  document.getElementById("currentRoom").innerText = "";
  document.getElementById("startCall").disabled = true;
  document.getElementById("joinCall").disabled = true;
  document.getElementById("hangUp").disabled = true;
  document.getElementById("muteAudio").disabled = true;
  document.getElementById("toggleVideo").disabled = true;

  // Reset room ID
  roomId = null;
  isCaller = false;
  remoteDescriptionSet = false;

  console.log("Call ended and all resources cleaned up.");
  location.reload();
}

// Event listeners
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