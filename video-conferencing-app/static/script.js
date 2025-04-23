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
let roomRef;
let callerCandidatesCollection;
let calleeCandidatesCollection;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 2;
const MAX_CONNECTION_TIME = 10000; // 10 seconds

// DOM elements
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
remoteVideo.srcObject = remoteStream;
const connectionStatus = document.getElementById("connectionStatus");
const statusText = document.getElementById("statusText");
const connectionQuality = document.getElementById("connectionQuality");
const copyRoomIdBtn = document.getElementById("copyRoomIdBtn");
const currentRoomDisplay = document.getElementById("currentRoom");
const connectionStateDisplay = document.getElementById("connectionState");

// ICE Servers configuration
const iceServers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    {
      urls: "turn:relay.metered.ca:443",
      username: "openai",
      credential: "openai123"
    }
  ]
};

// Initialize video call
function initializeVideoCall() {
  console.log("Video call initialized");
  updateConnectionStatus("Ready to connect", false);

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

// Update connection status UI
function updateConnectionStatus(text, show = true) {
  statusText.textContent = text;
  if (show) {
    connectionStatus.classList.add("visible");
  } else {
    connectionStatus.classList.remove("visible");
  }
}

// Update connection quality indicator
function updateConnectionQuality(quality) {
  connectionQuality.className = "connection-quality";
  connectionQuality.classList.add(quality);
  const qualityText = {
    good: "Good connection",
    medium: "Medium connection",
    poor: "Poor connection"
  };
  connectionQuality.innerHTML = `<i class="fas fa-circle"></i> <span>${qualityText[quality]}</span>`;
}

// Update connection state display
function updateConnectionState(state) {
  if (connectionStateDisplay) {
    connectionStateDisplay.textContent = `Connection State: ${state}`;
  }
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

    console.log("User media opened");
    updateConnectionStatus("Ready to connect", false);
  } catch (error) {
    console.error("Error accessing media devices:", error);
    updateConnectionStatus("Media access failed");
    alert("Unable to access camera and microphone. Please allow permissions and try again.");
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
  // Handle remote stream with browser compatibility
  peerConnection.ontrack = event => {
    // For Safari compatibility
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
    } else {
      // Fallback for other browsers
      event.streams[0].getTracks().forEach(track => {
        remoteStream.addTrack(track);
      });
      remoteVideo.srcObject = remoteStream;
    }
    console.log("Remote stream received.");
    updateConnectionQuality("good");
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
    const state = peerConnection.iceConnectionState;
    console.log("ICE connection state changed to:", state);
    updateConnectionState(state);
    
    switch (state) {
      case "connected":
        updateConnectionStatus("Connected", false);
        updateConnectionQuality("good");
        clearConnectionTimer();
        break;
      case "checking":
        updateConnectionStatus("Connecting...");
        updateConnectionQuality("medium");
        break;
      case "disconnected":
        updateConnectionStatus("Network issues detected...");
        updateConnectionQuality("poor");
        setTimeout(() => {
          if (peerConnection?.iceConnectionState === 'disconnected') {
            attemptIceRestart();
          }
        }, 2000);
        break;
      case "failed":
        updateConnectionStatus("Connection failed");
        updateConnectionQuality("poor");
        attemptIceRestart();
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

// Enhanced ICE restart mechanism
async function attemptIceRestart() {
  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    updateConnectionStatus("Connection failed. Please refresh.");
    return;
  }
  
  restartAttempts++;
  updateConnectionStatus(`Reconnecting (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`);
  
  try {
    // Use restartIce if available, otherwise create new offer
    if (peerConnection.restartIce) {
      peerConnection.restartIce();
    }
    
    const offer = await peerConnection.createOffer({ iceRestart: true });
    await peerConnection.setLocalDescription(offer);
    
    if (isCaller) {
      await roomRef.update({
        offer: {
          type: offer.type,
          sdp: offer.sdp
        }
      });
    }
  } catch (err) {
    console.error("ICE restart failed:", err);
    updateConnectionStatus("Restart failed");
  }
}

// Buffer ICE candidates until remote description is set and signaling state is stable
function handleIncomingIceCandidate(candidate) {
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

// Process buffered ICE candidates
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

// Toggle camera function
function toggleCamera() {
  if (localStream) {
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length > 0) {
      videoTracks[0].enabled = !videoTracks[0].enabled;
      const icon = videoTracks[0].enabled
        ? '<i class="fas fa-video"></i>'
        : '<i class="fas fa-video-slash"></i>';
      document.getElementById("toggleVideo").innerHTML = icon;
    }
  }
}

// Connection timer functions
function startConnectionTimer() {
  clearConnectionTimer();
  connectionTimer = setTimeout(() => {
    if (peerConnection && 
        (peerConnection.iceConnectionState === 'checking' || 
         peerConnection.iceConnectionState === 'disconnected')) {
      console.warn("Connection taking too long - attempting recovery");
      attemptIceRestart();
    }
  }, MAX_CONNECTION_TIME);
}

function clearConnectionTimer() {
  if (connectionTimer) {
    clearTimeout(connectionTimer);
    connectionTimer = null;
  }
}

// Start a new video call
async function startVideoCall() {
  try {
    isCaller = true;
    restartAttempts = 0;
    await setupMediaStream();
    
    peerConnection = createPeerConnection();
    setupPeerConnectionListeners();

    updateConnectionStatus("Creating offer...");
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
    currentRoomDisplay.innerText = `Room ID: ${roomId}`;
    document.getElementById("hangUp").disabled = false;

    // Initialize candidates collections
    callerCandidatesCollection = roomRef.collection("callerCandidates");
    calleeCandidatesCollection = roomRef.collection("calleeCandidates");

    startConnectionTimer();
    updateConnectionStatus("Waiting for answer...");

    roomRef.onSnapshot(async snapshot => {
      const data = snapshot.data();
      if (data?.answer) {
        try {
          // Handle ICE restart for callee
          if (!peerConnection.currentRemoteDescription || data.offer.type === 'offer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            remoteDescriptionSet = true;
            updateConnectionStatus("Connected", false);
            processBufferedCandidates();
          }
        } catch (error) {
          console.error("Error setting remote description:", error);
          updateConnectionStatus("Error processing answer");
        }
      }
    });

    calleeCandidatesCollection.onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          handleIncomingIceCandidate(candidate);
        }
      });
    });

  } catch (error) {
    console.error("Error starting video call:", error);
    updateConnectionStatus("Failed to start call");
    alert("Failed to start video call. Please check your media device access and internet.");
  }
}

// Join an existing room
async function joinRoom(roomIdInput) {
  try {
    isCaller = false;
    restartAttempts = 0;
    roomRef = db.collection("rooms").doc(roomIdInput);
    const roomSnapshot = await roomRef.get();

    if (!roomSnapshot.exists) {
      alert("The room ID you entered does not exist.");
      return;
    }

    console.log(`Joining room: ${roomIdInput}`);
    currentRoomDisplay.innerText = `Room ID: ${roomIdInput}`;
    roomId = roomIdInput;

    await setupMediaStream();
    peerConnection = createPeerConnection();
    setupPeerConnectionListeners();

    // Initialize candidates collections
    callerCandidatesCollection = roomRef.collection("callerCandidates");
    calleeCandidatesCollection = roomRef.collection("calleeCandidates");

    updateConnectionStatus("Processing offer...");
    const offer = roomSnapshot.data().offer;
    
    // Handle ICE restart for callee
    if (!peerConnection.currentRemoteDescription || offer.type === 'offer') {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      
      updateConnectionStatus("Creating answer...");
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
      updateConnectionStatus("Connected", false);
    }

    startConnectionTimer();

    callerCandidatesCollection.onSnapshot(snapshot => {
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
    updateConnectionStatus("Failed to join room");
    alert("Failed to join the room. Check your Room ID or connection.");
  }
}

// Hang up the call
async function hangUp() {
  console.log("Hanging up the call...");
  
  clearConnectionTimer();
  updateConnectionStatus("Call ended", false);

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
    remoteStream = new MediaStream();
  }

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  iceCandidateBuffer = [];

  // Clean up Firestore candidates
  if (callerCandidatesCollection) {
    try {
      const snapshot = await callerCandidatesCollection.get();
      snapshot.forEach(doc => doc.ref.delete());
    } catch (error) {
      console.error("Error deleting caller candidates:", error);
    }
  }

  if (calleeCandidatesCollection) {
    try {
      const snapshot = await calleeCandidatesCollection.get();
      snapshot.forEach(doc => doc.ref.delete());
    } catch (error) {
      console.error("Error deleting callee candidates:", error);
    }
  }

  if (roomRef) {
    if (isCaller) {
      try {
        await roomRef.delete();
      } catch (error) {
        console.error("Error deleting room:", error);
      }
    }
    roomRef = null;
  }

  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  
  currentRoomDisplay.innerText = "";
  document.getElementById("startCall").disabled = true;
  document.getElementById("joinCall").disabled = true;
  document.getElementById("hangUp").disabled = true;
  document.getElementById("muteAudio").disabled = true;
  document.getElementById("toggleVideo").disabled = true;

  roomId = null;
  isCaller = false;
  remoteDescriptionSet = false;
  restartAttempts = 0;

  console.log("Call ended and all resources cleaned up.");
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

  document.getElementById("toggleVideo").onclick = toggleCamera;

  // Copy room ID to clipboard
  if (copyRoomIdBtn) {
    copyRoomIdBtn.addEventListener("click", () => {
      if (roomId) {
        navigator.clipboard.writeText(roomId)
          .then(() => alert("Room ID copied to clipboard"))
          .catch(err => alert("Failed to copy Room ID: " + err));
      }
    });
  }
});