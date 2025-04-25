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
const copyRoomIdBtn = document.getElementById("copyRoomIdBtn");
const currentRoomDisplay = document.getElementById("currentRoom");
const connectionStateDisplay = document.getElementById("connectionState");

// Enhanced TURN credentials handling
async function fetchTurnCredentials() {
  try {
    console.log("Fetching TURN credentials...");
    
    const response = await fetch('/api/turn-credentials');
    
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
        { urls: "stun:stun1.google.com:19302" },
        { urls: "stun:stun2.google.com:19302" },
        ...turnServers.iceServers || []
      ]
    };
    
    console.log("Updated ICE servers configuration:", iceServers);
    lastCredentialsFetchTime = Date.now();
    return true;
  } catch (error) {
    console.error("Error fetching TURN credentials:", error);
    console.warn("Continuing with STUN servers only");
    iceServers = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.google.com:19302" },
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

// Initialize video call
async function initializeVideoCall() {
  console.log("Video call initialized");
  updateConnectionStatus("Ready to connect", false);

  await fetchTurnCredentials();

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

// Peer connection management
function createPeerConnection() {
  if (!iceServers) {
    console.error("ICE servers not configured");
    return null;
  }
  
  const pc = new RTCPeerConnection(iceServers);
  
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
    updateConnectionState(state);
    
    if (state === 'connected' || state === 'completed') {
      if (peerConnection.getStats) {
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
        });
      }
    }
    
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
    document.getElementById("hangUp").disabled = false;

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
      alert("Room not found");
      return;
    }

    roomId = roomIdInput;
    currentRoomDisplay.innerText = `Room ID: ${roomId}`;

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

    document.getElementById("hangUp").disabled = false;

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
    document.getElementById("toggleVideo").innerHTML = videoTracks[0].enabled ? 
      '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
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
  updateConnectionStatus("Call ended", false);
}

// Event listeners
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("startCall").onclick = startVideoCall;
  document.getElementById("joinCall").onclick = async () => {
    const roomId = prompt("Enter Room ID:");
    if (roomId) await joinRoom(roomId);
  };
  document.getElementById("hangUp").onclick = hangUp;
  document.getElementById("toggleVideo").onclick = toggleCamera;
  document.getElementById("muteAudio").onclick = () => {
    const audioTracks = localStream?.getAudioTracks();
    if (audioTracks?.length) {
      audioTracks[0].enabled = !audioTracks[0].enabled;
      document.getElementById("muteAudio").innerHTML = audioTracks[0].enabled ?
        '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    }
  };
});