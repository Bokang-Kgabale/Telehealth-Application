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
let lastCredentialsFetchTime = 0;
let iceServers = null;

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
    console.log("Fetching TURN credentials...");
    const response = await fetch('https://video-call-turn-server.metered.live/api/v1/turn/credentials?apiKey=830861d869e2d2005321d5f5b2cbc7e141f4');
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Server response:", errorText);
      throw new Error(`Failed to fetch TURN credentials: ${response.statusText}`);
    }
    
    const turnServers = await response.json();
    console.log("Received TURN servers:", turnServers);
    
    iceServers = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        ...(turnServers.iceServers || turnServers || [])
      ]
    };
    
    console.log("Updated ICE servers configuration:", iceServers);
    lastCredentialsFetchTime = Date.now();
    return true;
  } catch (error) {
    console.error("Error fetching TURN credentials:", error);
    iceServers = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.google.com:19302" }
      ]
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

// Functions for UI status updates
function updateConnectionStatus(message, isConnecting = true) {
  statusText.textContent = message;
  connectionStatus.className = isConnecting ? "connection-status connecting" : "connection-status ready";
  console.log(`Connection status: ${message}`);
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
  console.log(`Connection quality: ${qualityText}`);
}

// Initialize video call
function initializeVideoCall() {
  console.log("Video call initialized");
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
      audio: true 
    });
    localVideo.srcObject = localStream;

    startCallBtn.disabled = false;
    joinCallBtn.disabled = false;
    muteAudioBtn.disabled = false;
    toggleVideoBtn.disabled = false;

    console.log("User media opened");
    updateConnectionStatus("Ready to connect", false);
    
    // Hide open media button after successful access
    if (openMediaBtn) {
      openMediaBtn.style.display = 'none';
    }
  } catch (error) {
    console.error("Error accessing media devices:", error);
    updateConnectionStatus("Media access failed");
    alert("Unable to access camera and microphone. Please allow permissions and try again.");
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
    iceTransportPolicy: 'all' // Use 'relay' in production to force TURN
  });
  
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  return pc;
}

function setupPeerConnectionListeners() {
  peerConnection.ontrack = event => {
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
    } else {
      event.streams[0].getTracks().forEach(track => {
        remoteStream.addTrack(track);
      });
      remoteVideo.srcObject = remoteStream;
    }
    console.log("Remote stream received.");
    updateConnectionQuality("good");
  };

  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      console.log("New ICE candidate:", event.candidate);
      
      if (event.candidate.candidate.includes('relay')) {
        console.log("TURN server being used");
      }
      
      if (roomId) {
        const collectionName = isCaller ? "callerCandidates" : "calleeCandidates";
        db.collection("rooms").doc(roomId).collection(collectionName).add(event.candidate.toJSON())
          .catch(e => console.error("Error sending ICE candidate:", e));
      }
    } else {
      console.log("ICE gathering complete");
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    const state = peerConnection.iceConnectionState;
    console.log("ICE connection state:", state);
    
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
          if (peerConnection?.iceConnectionState === 'disconnected') {
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
    
    if (state === 'connected' || state === 'completed') {
      peerConnection.getStats().then(stats => {
        stats.forEach(report => {
          if (report.type === 'candidate-pair' && report.selected) {
            console.log("Selected candidate pair:", report);
            if (report.localCandidateId) {
              const localCandidate = stats.get(report.localCandidateId);
              if (localCandidate) {
                console.log("Using TURN:", localCandidate.candidateType === 'relay');
              }
            }
          }
        });
      }).catch(err => console.error("Error getting stats:", err));
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
  updateConnectionStatus(`Reconnecting (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`);
  
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
          sdp: offer.sdp
        }
      });
    }
  } catch (err) {
    console.error("ICE restart failed:", err);
    updateConnectionStatus("Restart failed");
  }
}

async function processBufferedCandidates() {
  if (iceCandidateBuffer.length > 0) {
    console.log(`Processing ${iceCandidateBuffer.length} buffered ICE candidates`);
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
    isCaller = true;
    restartAttempts = 0;
    await ensureFreshCredentials();
    await setupMediaStream();
    
    peerConnection = createPeerConnection();
    setupPeerConnectionListeners();

    updateConnectionStatus("Creating offer...");
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    roomRef = await db.collection("rooms").add({
      offer: {
        type: offer.type,
        sdp: offer.sdp
      }
    });
    roomId = roomRef.id;

    currentRoomDisplay.innerText = `Room ID: ${roomId}`;
    hangUpBtn.disabled = false;

    callerCandidatesCollection = roomRef.collection("callerCandidates");
    calleeCandidatesCollection = roomRef.collection("calleeCandidates");

    startConnectionTimer();
    updateConnectionStatus("Waiting for answer...");

    roomRef.onSnapshot(async snapshot => {
      const data = snapshot.data();
      if (data?.answer) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        remoteDescriptionSet = true;
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
  }
}

async function joinRoom(roomIdInput) {
  try {
    isCaller = false;
    restartAttempts = 0;
    await ensureFreshCredentials();
    
    roomRef = db.collection("rooms").doc(roomIdInput);
    const roomSnapshot = await roomRef.get();

    if (!roomSnapshot.exists) {
      alert("The room ID you entered does not exist.");
      return;
    }

    console.log(`Joining room: ${roomIdInput}`);
    currentRoomDisplay.innerText = `Room ID: ${roomIdInput}`;
    roomId = roomIdInput;

    callerCandidatesCollection = roomRef.collection("callerCandidates");
    calleeCandidatesCollection = roomRef.collection("calleeCandidates");

    await setupMediaStream();
    peerConnection = createPeerConnection();
    setupPeerConnectionListeners();

    const offer = roomSnapshot.data().offer;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    updateConnectionStatus("Creating answer...");
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    await roomRef.update({
      answer: {
        type: answer.type,
        sdp: answer.sdp
      }
    });

    remoteDescriptionSet = true;
    startConnectionTimer();

    callerCandidatesCollection.onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          handleIncomingIceCandidate(candidate);
        }
      });
    });

    hangUpBtn.disabled = false;

  } catch (error) {
    console.error("Error joining room:", error);
    updateConnectionStatus("Failed to join room");
  }
}

// Helper functions
async function setupMediaStream() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  }
}

function handleIncomingIceCandidate(candidate) {
  if (remoteDescriptionSet && peerConnection.signalingState === "stable") {
    peerConnection.addIceCandidate(candidate).catch(e => console.error("Error adding ICE candidate:", e));
  } else {
    iceCandidateBuffer.push(candidate);
  }
}

function startConnectionTimer() {
  clearConnectionTimer();
  connectionTimer = setTimeout(() => {
    if (peerConnection?.iceConnectionState === 'checking') {
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
    localStream.getTracks().forEach(track => track.stop());
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
  
  // Reset UI state
  startCallBtn.disabled = true;
  joinCallBtn.disabled = true;
  hangUpBtn.disabled = true;
  muteAudioBtn.disabled = true;
  toggleVideoBtn.disabled = true;
  
  // Show open media button again
  if (openMediaBtn) {
    openMediaBtn.style.display = 'block';
  }

  updateConnectionStatus("Call ended", false);
}

// Initialize the application
document.addEventListener("DOMContentLoaded", initializeVideoCall);