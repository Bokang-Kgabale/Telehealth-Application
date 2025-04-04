// Firebase configuration
async function loadFirebaseConfig() {
    try {
        const response = await fetch('/config/firebaseConfig.json');
        const firebaseConfig = await response.json();
        firebase.initializeApp(firebaseConfig);
        const db = firebase.firestore();
        console.log("Firebase initialized successfully.");
        return db;
    } catch (error) {
        console.error("Error loading Firebase configuration:", error);
        alert("Failed to load Firebase configuration.");
    }
}

let db;
loadFirebaseConfig().then(database => {
    db = database;
});

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

let localStream;
let remoteStream = new MediaStream();
remoteVideo.srcObject = remoteStream;
let peerConnection;
let roomId;

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
        localVideo.srcObject = localStream;

        document.getElementById("startCall").disabled = false;
        document.getElementById("joinCall").disabled = false;
    } catch (error) {
        console.error("Error accessing media devices:", error);
        alert("Unable to access camera and microphone. Please check your permissions.");
    }
}

// Start a video call
async function startVideoCall() {
    try {
        console.log("Starting video call...");
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;

        // Initialize PeerConnection
        peerConnection = new RTCPeerConnection(iceServers);

        // Add local tracks to PeerConnection
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        // Handle remote tracks
        peerConnection.ontrack = event => {
            event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = event => {
            if (event.candidate) {
                db.collection("rooms").doc(roomId).collection("callerCandidates").add(event.candidate.toJSON());
            }
        };

        // Create an SDP offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Create a Firestore room
        const roomWithOffer = {
            offer: {
                type: offer.type,
                sdp: offer.sdp
            }
        };
        const roomRef = await db.collection("rooms").add(roomWithOffer);
        roomId = roomRef.id;

        console.log(`Room created with ID: ${roomId}`);
        document.getElementById("currentRoom").innerText = `Room ID: ${roomId}`;

        // Enable the Hang Up button
        document.getElementById("hangUp").disabled = false;

        // Listen for remote answer
        roomRef.onSnapshot(async snapshot => {
            const data = snapshot.data();
            if (data?.answer && !peerConnection.currentRemoteDescription) {
                const answer = new RTCSessionDescription(data.answer);
                await peerConnection.setRemoteDescription(answer);
            }
        });

        // Listen for remote ICE candidates
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

        // Initialize PeerConnection
        peerConnection = new RTCPeerConnection(iceServers);

        // Add local tracks to PeerConnection
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        // Handle remote tracks
        peerConnection.ontrack = event => {
            event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = event => {
            if (event.candidate) {
                roomRef.collection("calleeCandidates").add(event.candidate.toJSON());
            }
        };

        // Set remote description and create an answer
        const offer = roomSnapshot.data().offer;
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        // Update Firestore with the answer
        const roomWithAnswer = { answer: { type: answer.type, sdp: answer.sdp } };
        await roomRef.update(roomWithAnswer);

        // Listen for remote ICE candidates
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

    // Stop all tracks in the local stream
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            console.log("Stopped local track:", track);
        });
        localStream = null; // Clear the local stream reference
    }

    // Stop all tracks in the remote stream
    if (remoteStream) {
        remoteStream.getTracks().forEach(track => {
            track.stop();
            console.log("Stopped remote track:", track);
        });
        remoteStream = null; // Clear the remote stream reference
    }

    // Clear the video elements
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;

    // Close the peer connection
    if (peerConnection) {
        peerConnection.close();
        console.log("Peer connection closed.");
        peerConnection = null; // Clear the peer connection reference
    }

    // Reset the UI
    document.getElementById("currentRoom").innerText = "";
    document.getElementById("startCall").disabled = true;
    document.getElementById("joinCall").disabled = true;
    document.getElementById("hangUp").disabled = true;

    console.log("Call ended and UI reset.");

    // Reload the page to reset the application
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

document.addEventListener("DOMContentLoaded", () => {
    const localVideo = document.getElementById("localVideo");
    const remoteVideo = document.getElementById("remoteVideo");
    const openMediaButton = document.getElementById("openMedia");
    const muteAudioButton = document.getElementById("muteAudio");
    const hangUpButton = document.getElementById("hangUp");

    let localStream;
    let isVideoEnabled = true;
    let isAudioEnabled = true;

    // Open Media (Camera and Microphone)
    openMediaButton.onclick = async () => {
        if (!localStream) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localVideo.srcObject = localStream;
                console.log("Media devices accessed successfully.");
                openMediaButton.innerHTML = '<i class="fas fa-video-slash"></i>'; // Change icon to indicate video can be turned off
            } catch (error) {
                console.error("Error accessing media devices:", error);
                alert("Unable to access camera and microphone. Please check your permissions.");
            }
        } else {
            // Toggle video on/off
            const videoTrack = localStream.getVideoTracks()[0];
            isVideoEnabled = !isVideoEnabled;
            videoTrack.enabled = isVideoEnabled;
            openMediaButton.innerHTML = isVideoEnabled
                ? '<i class="fas fa-video"></i>' // Video is on
                : '<i class="fas fa-video-slash"></i>'; // Video is off
            console.log("Video", isVideoEnabled ? "enabled" : "disabled");
        }
    };

    // Mute/Unmute Audio
    muteAudioButton.onclick = () => {
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            isAudioEnabled = !isAudioEnabled;
            audioTrack.enabled = isAudioEnabled;
            muteAudioButton.innerHTML = isAudioEnabled
                ? '<i class="fas fa-microphone"></i>'
                : '<i class="fas fa-microphone-slash"></i>';
            console.log("Audio", isAudioEnabled ? "unmuted" : "muted");
        }
    };

    // Hang Up
    hangUpButton.onclick = () => {
        if (localStream) {
            localStream.getTracks().forEach((track) => track.stop());
            localVideo.srcObject = null;
            localStream = null;
            isVideoEnabled = true;
            isAudioEnabled = true;
            openMediaButton.innerHTML = '<i class="fas fa-video"></i>'; // Reset icon
            muteAudioButton.innerHTML = '<i class="fas fa-microphone"></i>'; // Reset icon
            console.log("Call ended and media tracks stopped.");
        }
    };
});
