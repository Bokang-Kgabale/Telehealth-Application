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
let restartAttempts = 0;

// Constants
const MAX_CONNECTION_TIME = 10000; // 10 seconds
const MAX_RESTART_ATTEMPTS = 2;

// DOM elements
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
remoteVideo.srcObject = remoteStream;
const connectionStatus = document.getElementById("connectionStatus");
const statusText = document.getElementById("statusText");
const connectionQuality = document.getElementById("connectionQuality");

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
  ],
  iceTransportPolicy: "all",
  iceCandidatePoolSize: 4
};

// Initialize video call
function initializeVideoCall() {
  console.log("Video call initialized");
  updateConnectionStatus("Ready to connect", false);

  navigator.permissions?.query?.({ name: "camera" })
    .then(permissionStatus => {
      if (permissionStatus.state === "granted") {
        openUserMedia();
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

    // Enable all relevant buttons
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

// Start a new video call
async function startVideoCall() {
  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
    }

    isCaller = true;
    restartAttempts = 0;
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
      updateConnectionQuality("good");
    };

    peerConnection.onicecandidate = event => {
      if (event.candidate && roomId) {
        console.log("New ICE candidate generated:", event.candidate);
        db.collection("rooms").doc(roomId).collection("callerCandidates").add(event.candidate.toJSON());
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      const state = peerConnection.iceConnectionState;
      console.log("ICE connection state changed to:", state);
      
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
            if (peerConnection?.iceConnectionState === "disconnected") {
              attemptIceRestart();
            }
          }, 2000);
          break;
        case "failed":
          updateConnectionStatus("Connection failed");
          attemptIceRestart();
          break;
      }
    };

    peerConnection.onsignalingstatechange = () => {
      console.log("Signaling state changed to:", peerConnection.signalingState);
      if (peerConnection.signalingState === "stable") {
        processBufferedCandidates();
      }
    };

    updateConnectionStatus("Creating offer...");
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

    startConnectionTimer();
    updateConnectionStatus("Waiting for answer...");

    roomRef.onSnapshot(async snapshot => {
      const data = snapshot.data();
      if (data?.answer) {
        try {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
          remoteDescriptionSet = true;
          updateConnectionStatus("Connected", false);
          processBufferedCandidates();
        } catch (error) {
          console.error("Error setting remote description:", error);
          updateConnectionStatus("Error processing answer");
        }
      }
    });

    roomRef.collection("calleeCandidates").onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          if (remoteDescriptionSet && peerConnection.signalingState === "stable") {
            addIceCandidateSafely(candidate);
          } else {
            iceCandidateBuffer.push(candidate);
          }
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
    document.getElementById("currentRoom").innerText = `Room ID: ${roomIdInput}`;
    roomId = roomIdInput;

    await setupMediaStream();
    peerConnection = createPeerConnection();
    setupPeerConnectionListeners();

    updateConnectionStatus("Processing offer...");
    const offer = roomSnapshot.data().offer;
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

    startConnectionTimer();

    roomRef.collection("callerCandidates").onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          if (remoteDescriptionSet && peerConnection.signalingState === "stable") {
            addIceCandidateSafely(candidate);
          } else {
            iceCandidateBuffer.push(candidate);
          }
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

// ICE restart implementation
async function attemptIceRestart() {
  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    updateConnectionStatus("Connection failed. Please refresh.");
    return;
  }
  
  restartAttempts++;
  updateConnectionStatus(`Reconnecting (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`);
  
  try {
    const offer = await peerConnection.createOffer({ iceRestart: true });
    await peerConnection.setLocalDescription(offer);
    
    if (isCaller) {
      await roomRef.update({
        offer: {
          type: offer.type,
          sdp: offer.sdp
        }
      });
      updateConnectionStatus("Sent new offer...");
    }
  } catch (err) {
    console.error("ICE restart failed:", err);
    updateConnectionStatus("Restart failed");
  }
}

// Helper functions
function updateConnectionStatus(text, show = true) {
  statusText.textContent = text;
  if (show) {
    connectionStatus.classList.add("visible");
  } else {
    connectionStatus.classList.remove("visible");
  }
}

function updateConnectionQuality(quality) {
  connectionQuality.className = "connection-quality";
  if (quality === "good") {
    connectionQuality.classList.add("good");
  } else if (quality === "medium") {
    connectionQuality.classList.add("medium");
  } else if (quality === "poor") {
    connectionQuality.classList.add("poor");
  }
}

async function setupMediaStream() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  }
}

async function addIceCandidateSafely(candidate) {
  try {
    await peerConnection.addIceCandidate(candidate);
    console.log("Successfully added ICE candidate");
  } catch (e) {
    console.error("Error adding ICE candidate:", e);
  }
}

async function processBufferedCandidates() {
  if (iceCandidateBuffer.length > 0) {
    console.log(`Processing ${iceCandidateBuffer.length} buffered ICE candidates`);
    for (const candidate of iceCandidateBuffer) {
      await addIceCandidateSafely(candidate);
    }
    iceCandidateBuffer = [];
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
  
  document.getElementById("currentRoom").innerText = "";
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
      const audioTracks = localStream.getAudioTracks();
      audioTracks.forEach(track => track.enabled = !track.enabled);
      const icon = audioTracks[0].enabled 
        ? '<i class="fas fa-microphone"></i>' 
        : '<i class="fas fa-microphone-slash"></i>';
      document.getElementById("muteAudio").innerHTML = icon;
    }
  };

  document.getElementById("toggleVideo").onclick = () => {
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      videoTracks.forEach(track => track.enabled = !track.enabled);
      const icon = videoTracks[0].enabled
        ? '<i class="fas fa-video"></i>'
        : '<i class="fas fa-video-slash"></i>';
      document.getElementById("toggleVideo").innerHTML = icon;
    }
  };
});