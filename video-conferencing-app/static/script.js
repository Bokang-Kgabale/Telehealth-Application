// Firebase configuration with debugging
fetch("/firebase-config")
  .then((res) => {
    console.log("Firebase config response status:", res.status);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    return res.json();
  })
  .then((config) => {
    console.log("Received Firebase config:", config);

    // Validate minimum required fields
    const requiredFields = ["apiKey", "authDomain", "projectId"];
    const missingFields = requiredFields.filter((field) => !config[field]);
    if (missingFields.length > 0) {
      throw new Error(
        `Missing required Firebase config fields: ${missingFields.join(", ")}`
      );
    }

    try {
      // Initialize Firebase
      const firebaseApp = firebase.initializeApp(config);
      console.log("Firebase initialized successfully:", firebaseApp.name);

      // Initialize Firestore with debug settings
      db = firebase.firestore();
      if (window.location.hostname === "localhost") {
        db.settings({
          experimentalForceLongPolling: true,
          merge: true,
        });
        console.log("Firestore configured for local development");
      }

      // Test Firestore connection
      db.collection("testConnection")
        .doc("test")
        .get()
        .then(() => console.log("Firestore connection successful"))
        .catch((e) => console.error("Firestore connection failed:", e));

      initializeVideoCall();
    } catch (initError) {
      console.error("Firebase initialization error:", initError);
      throw initError;
    }
  })
  .catch((error) => {
    console.error("Error loading Firebase configuration:", error);
    alert(`Firebase init failed: ${error.message}\nCheck console for details.`);
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
let lastCredentialsFetchTime = 0;
let iceServers = null;

// Add this near the top of script.js (after the global variables)
window.addEventListener('message', (event) => {
  // Verify origin matches your patient dashboard
  if (event.origin !== "http://localhost:3000") return; // Adjust to your dashboard URL

  if (event.data.type === "JOIN_ROOM" && event.data.roomId) {
    console.log("Received room join request:", event.data.roomId);
    joinRoom(event.data.roomId).catch(error => {
      console.error("Failed to join room:", error);
    });
  }
});

// DOM elements
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
remoteVideo.srcObject = remoteStream;
const connectionStatus = document.getElementById("connectionStatus");
const statusText = document.getElementById("statusText");
const connectionQuality = document.getElementById("connectionQuality");
const currentRoomDisplay = document.getElementById("currentRoom");
const openMediaBtn = document.getElementById("openMedia");
const startCallBtn = document.getElementById("startCall");
const joinCallBtn = document.getElementById("joinCall");
const hangUpBtn = document.getElementById("hangUp");
const toggleVideoBtn = document.getElementById("toggleVideo");
const muteAudioBtn = document.getElementById("muteAudio");

// Enhanced TURN credentials handling
async function fetchTurnCredentials() {
  try {
    const response = await fetch("/api/turn-credentials");

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Server response:", errorText);
      throw new Error(
        `Failed to fetch TURN credentials: ${response.statusText}`
      );
    }

    const turnServers = await response.json();
    iceServers = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        ...(turnServers.iceServers || turnServers || []),
      ],
    };

    lastCredentialsFetchTime = Date.now();
    return true;
  } catch (error) {
    console.error("Error fetching TURN credentials:", error);
    iceServers = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
      ],
    };
    return false;
  }
}

async function ensureFreshCredentials() {
  const timeSinceLastFetch = Date.now() - lastCredentialsFetchTime;
  if (!lastCredentialsFetchTime || timeSinceLastFetch > 50 * 60 * 1000) {
    await fetchTurnCredentials();
  }
}

// UI status updates
function updateConnectionStatus(message, isConnecting = true) {
  statusText.textContent = message;
  connectionStatus.className = isConnecting
    ? "connection-status connecting"
    : "connection-status ready";
}

function updateConnectionQuality(quality) {
  connectionQuality.className = `connection-quality ${quality}`;

  let qualityText = "Unknown";
  switch (quality) {
    case "good":
      qualityText = "Good";
      break;
    case "medium":
      qualityText = "Medium";
      break;
    case "poor":
      qualityText = "Poor";
      break;
  }

  connectionQuality.innerHTML = `<i class="fas fa-circle"></i><span>${qualityText}</span>`;
}

// Initialize video call
function initializeVideoCall() {
  updateConnectionStatus("Ready to connect", false);
  setupUI();
}

// Set up UI event listeners
function setupUI() {
  if (openMediaBtn) {
    openMediaBtn.addEventListener("click", openUserMedia);
  }

  startCallBtn.addEventListener("click", startVideoCall);
  joinCallBtn.addEventListener("click", async () => {
    const inputId = prompt("Enter Room ID:");
    if (inputId) await joinRoom(inputId);
  });
  hangUpBtn.addEventListener("click", hangUp);
  toggleVideoBtn.addEventListener("click", toggleCamera);
  muteAudioBtn.addEventListener("click", toggleMic);
}

// Toggle microphone function
function toggleMic() {
  if (localStream) {
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length > 0) {
      audioTracks[0].enabled = !audioTracks[0].enabled;
      const icon = audioTracks[0].enabled
        ? '<i class="fas fa-microphone"></i>'
        : '<i class="fas fa-microphone-slash"></i>';
      muteAudioBtn.innerHTML = icon;
    }
  }
}

// Request user media
async function openUserMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localVideo.srcObject = localStream;

    startCallBtn.disabled = false;
    joinCallBtn.disabled = false;
    muteAudioBtn.disabled = false;
    toggleVideoBtn.disabled = false;

    updateConnectionStatus("Ready to connect", false);

    if (openMediaBtn) {
      openMediaBtn.style.display = "none";
    }
  } catch (error) {
    console.error("Error accessing media devices:", error);
    updateConnectionStatus("Media access failed");
    alert(
      "Unable to access camera and microphone. Please allow permissions and try again."
    );
  }
}

// Peer connection management
function createPeerConnection() {
  if (!iceServers) {
    console.error("ICE servers not configured");
    return null;
  }

  const pc = new RTCPeerConnection({
    iceServers: iceServers.iceServers || iceServers,
    iceTransportPolicy: "all",
  });

  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  return pc;
}

function setupPeerConnectionListeners() {
  peerConnection.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
    } else {
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
      remoteVideo.srcObject = remoteStream;
    }
    updateConnectionQuality("good");
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && roomId) {
      const collectionName = isCaller ? "callerCandidates" : "calleeCandidates";
      db.collection("rooms")
        .doc(roomId)
        .collection(collectionName)
        .add(event.candidate.toJSON())
        .catch((e) => console.error("Error sending ICE candidate:", e));
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    const state = peerConnection.iceConnectionState;

    let statusMessage = "Ready to connect";
    switch (state) {
      case "connected":
      case "completed":
        statusMessage = "Connected";
        updateConnectionQuality("good");
        clearConnectionTimer();
        break;
      case "checking":
        statusMessage = "Connecting...";
        updateConnectionQuality("medium");
        break;
      case "disconnected":
        statusMessage = "Network issues detected...";
        updateConnectionQuality("poor");
        setTimeout(() => {
          if (peerConnection?.iceConnectionState === "disconnected") {
            attemptIceRestart();
          }
        }, 2000);
        break;
      case "failed":
        statusMessage = "Connection failed";
        updateConnectionQuality("poor");
        attemptIceRestart();
        break;
    }
    updateConnectionStatus(statusMessage, state !== "connected");

    if (state === "connected" || state === "completed") {
      peerConnection
        .getStats()
        .then((stats) => {
          stats.forEach((report) => {
            if (report.type === "candidate-pair" && report.selected) {
              if (report.localCandidateId) {
                const localCandidate = stats.get(report.localCandidateId);
              }
            }
          });
        })
        .catch((err) => console.error("Error getting stats:", err));
    }
  };

  peerConnection.onsignalingstatechange = () => {
    if (peerConnection.signalingState === "stable") {
      processBufferedCandidates();
    }
  };
}

async function attemptIceRestart() {
  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    updateConnectionStatus("Connection failed. Please refresh.");
    return;
  }

  restartAttempts++;
  updateConnectionStatus(
    `Reconnecting (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`
  );

  try {
    await ensureFreshCredentials();

    if (peerConnection.restartIce) {
      peerConnection.restartIce();
    }

    const offer = await peerConnection.createOffer({ iceRestart: true });
    await peerConnection.setLocalDescription(offer);

    if (isCaller) {
      await roomRef.update({
        offer: {
          type: offer.type,
          sdp: offer.sdp,
        },
      });
    }
  } catch (err) {
    console.error("ICE restart failed:", err);
    updateConnectionStatus("Restart failed");
  }
}

async function processBufferedCandidates() {
  if (iceCandidateBuffer.length > 0) {
    for (const candidate of iceCandidateBuffer) {
      try {
        await peerConnection.addIceCandidate(candidate);
      } catch (e) {
        console.error("Error adding buffered ICE candidate:", e);
      }
    }
    iceCandidateBuffer = [];
  }
}

// Call management
async function startVideoCall() {
  try {
    console.log("[Debug] Starting video call...");
    isCaller = true;
    restartAttempts = 0;

    console.log("[Debug] Ensuring fresh credentials");
    await ensureFreshCredentials();

    console.log("[Debug] Setting up media stream");
    await setupMediaStream();

    console.log("[Debug] Creating peer connection");
    peerConnection = createPeerConnection();
    if (!peerConnection) throw new Error("Failed to create peer connection");
    setupPeerConnectionListeners();

    console.log("[Debug] Creating offer");
    updateConnectionStatus("Creating offer...");
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    console.log("[Debug] Creating Firestore room");
    roomRef = await db.collection("rooms").add({
      offer: {
        type: offer.type,
        sdp: offer.sdp,
      },
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    roomId = roomRef.id;

    console.log("[Debug] Room created with ID:", roomId);
    currentRoomDisplay.innerText = `${roomId}`;
    hangUpBtn.disabled = false;

    // Get the parent origin dynamically
    const parentOrigin =
      window.location.ancestorOrigins?.[0] || "http://localhost:3000"; //change to your dashboard URL if needed

    // Notify parent window (dashboard) that a room was created
    const message = {
      type: "ROOM_CREATED",
      roomId: roomId,
      timestamp: Date.now(),
    };

    // Send to parent with proper origin
    console.log(`Sending to ${parentOrigin}`);
    window.parent.postMessage(message, parentOrigin);
    console.log("Sent roomId to parent. Origin:", parentOrigin);

    callerCandidatesCollection = roomRef.collection("callerCandidates");
    calleeCandidatesCollection = roomRef.collection("calleeCandidates");

    startConnectionTimer();
    updateConnectionStatus("Waiting for answer...");

    roomRef.onSnapshot(async (snapshot) => {
      const data = snapshot.data();
      if (data?.answer) {
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(data.answer)
        );
        remoteDescriptionSet = true;
      }
    });

    calleeCandidatesCollection.onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          handleIncomingIceCandidate(candidate);
        }
      });
    });
  } catch (error) {
    console.error("Error starting video call:", {
      message: error.message,
      stack: error.stack,
      error: error,
    });
    updateConnectionStatus("Failed to start call");
  }
}

async function joinRoom(roomIdInput) {
  try {
    // Reset state
    isCaller = false;
    restartAttempts = 0;
    remoteDescriptionSet = false;
    iceCandidateBuffer = [];
    
    // Ensure we have fresh credentials
    await ensureFreshCredentials();

    // Get room reference and check existence
    roomRef = db.collection("rooms").doc(roomIdInput);
    const roomSnapshot = await roomRef.get();

    if (!roomSnapshot.exists) {
      alert("The room ID you entered does not exist.");
      return;
    }

    // Update UI with room ID
    currentRoomDisplay.innerText = `${roomIdInput}`;
    roomId = roomIdInput;

    // Set up collections
    callerCandidatesCollection = roomRef.collection("callerCandidates");
    calleeCandidatesCollection = roomRef.collection("calleeCandidates");

    // Set up media and peer connection
    await setupMediaStream();
    
    // Clean up any existing connection
    if (peerConnection) {
      peerConnection.close();
    }
    
    peerConnection = createPeerConnection();
    setupPeerConnectionListeners();

    // Get the offer from Firestore
    const offer = roomSnapshot.data().offer;
    if (!offer) {
      throw new Error("No offer found in room");
    }

    // Set remote description first
    updateConnectionStatus("Setting remote description...");
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer))
      .catch(e => {
        console.error("setRemoteDescription failed:", e);
        throw e;
      });

    // Create and set local description
    updateConnectionStatus("Creating answer...");
    const answer = await peerConnection.createAnswer()
      .catch(e => {
        console.error("createAnswer failed:", e);
        throw e;
      });

    await peerConnection.setLocalDescription(answer)
      .catch(e => {
        console.error("setLocalDescription failed:", e);
        throw e;
      });

    // Save answer to Firestore
    await roomRef.update({
      answer: {
        type: answer.type,
        sdp: answer.sdp,
      },
      answerCreatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    remoteDescriptionSet = true;
    startConnectionTimer();

    // Set up candidate listener
    callerCandidatesCollection.onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          handleIncomingIceCandidate(candidate);
        }
      });
    });

    hangUpBtn.disabled = false;
  } catch (error) {
    console.error("Error joining room:", {
      error: error,
      message: error.message,
      stack: error.stack
    });
    updateConnectionStatus("Failed to join room");
    
    // Clean up on failure
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
  }
}

// Helper functions
async function setupMediaStream() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localVideo.srcObject = localStream;
  }
}

function handleIncomingIceCandidate(candidate) {
  if (remoteDescriptionSet && peerConnection.signalingState === "stable") {
    peerConnection
      .addIceCandidate(candidate)
      .catch((e) => console.error("Error adding ICE candidate:", e));
  } else {
    iceCandidateBuffer.push(candidate);
  }
}

function startConnectionTimer() {
  clearConnectionTimer();
  connectionTimer = setTimeout(() => {
    if (peerConnection?.iceConnectionState === "checking") {
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

// UI Controls
function toggleCamera() {
  const videoTracks = localStream?.getVideoTracks();
  if (videoTracks?.length) {
    videoTracks[0].enabled = !videoTracks[0].enabled;
    const icon = videoTracks[0].enabled
      ? '<i class="fas fa-video"></i>'
      : '<i class="fas fa-video-slash"></i>';
    toggleVideoBtn.innerHTML = icon;
  }
}

async function hangUp() {
  clearConnectionTimer();

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (roomRef && isCaller) {
    await roomRef.delete();
  }

  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  currentRoomDisplay.innerText = "";

  startCallBtn.disabled = true;
  joinCallBtn.disabled = true;
  hangUpBtn.disabled = true;
  muteAudioBtn.disabled = true;
  toggleVideoBtn.disabled = true;

  if (openMediaBtn) {
    openMediaBtn.style.display = "block";
  }

  updateConnectionStatus("Call ended", false);
}

// Initialize the application
document.addEventListener("DOMContentLoaded", initializeVideoCall);
