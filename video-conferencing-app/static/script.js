// Updated WebRTC logic with enhanced debugging and proper stream handling

let localStream;
let remoteStream = new MediaStream();
let peerConnection;
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
    // Add TURN server here if needed
  ]
};

const roomInput = document.getElementById("room-id");
const createButton = document.getElementById("createBtn");
const joinButton = document.getElementById("joinBtn");
const hangupButton = document.getElementById("hangupBtn");

createButton.addEventListener("click", createRoom);
joinButton.addEventListener("click", joinRoom);
hangupButton.addEventListener("click", hangUp);

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

async function openUserMedia() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  console.log("User media opened:", stream);
  localVideo.srcObject = stream;
  localStream = stream;
}

async function createRoom() {
  const db = firebase.firestore();
  const roomRef = await db.collection("rooms").doc();

  peerConnection = new RTCPeerConnection(configuration);

  // Handle ICE candidates
  const callerCandidatesCollection = roomRef.collection("callerCandidates");
  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      callerCandidatesCollection.add(event.candidate.toJSON());
    }
  };

  // Track remote stream
  peerConnection.ontrack = event => {
    console.log("Remote track received:", event.streams[0]);
    if (remoteVideo.srcObject !== event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
    }
    event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
  };

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  const roomWithOffer = {
    offer: {
      type: offer.type,
      sdp: offer.sdp
    }
  };
  await roomRef.set(roomWithOffer);
  window.currentRoom = roomRef.id;
  roomInput.value = roomRef.id;

  roomRef.onSnapshot(async snapshot => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data?.answer) {
      const answer = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(answer);
    }
  });

  roomRef.collection("calleeCandidates").onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === "added") {
        const candidate = new RTCIceCandidate(change.doc.data());
        await peerConnection.addIceCandidate(candidate);
      }
    });
  });

  peerConnection.oniceconnectionstatechange = () => {
    console.log("ICE connection state:", peerConnection.iceConnectionState);
  };

  peerConnection.onconnectionstatechange = () => {
    console.log("Connection state:", peerConnection.connectionState);
  };

  setTimeout(() => {
    peerConnection.getSenders().forEach(sender => console.log("Sender track:", sender.track));
    peerConnection.getReceivers().forEach(receiver => console.log("Receiver track:", receiver.track));
  }, 3000);
}

async function joinRoom() {
  const db = firebase.firestore();
  const roomId = roomInput.value;
  const roomRef = db.collection("rooms").doc(roomId);

  const roomSnapshot = await roomRef.get();
  if (!roomSnapshot.exists) {
    console.error("Room does not exist:", roomId);
    return;
  }

  peerConnection = new RTCPeerConnection(configuration);

  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      roomRef.collection("calleeCandidates").add(event.candidate.toJSON());
    }
  };

  peerConnection.ontrack = event => {
    console.log("Remote track received:", event.streams[0]);
    if (remoteVideo.srcObject !== event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
    }
    event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
  };

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

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

  roomRef.collection("callerCandidates").onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === "added") {
        const candidate = new RTCIceCandidate(change.doc.data());
        await peerConnection.addIceCandidate(candidate);
      }
    });
  });

  peerConnection.oniceconnectionstatechange = () => {
    console.log("ICE connection state:", peerConnection.iceConnectionState);
  };

  peerConnection.onconnectionstatechange = () => {
    console.log("Connection state:", peerConnection.connectionState);
  };

  setTimeout(() => {
    peerConnection.getSenders().forEach(sender => console.log("Sender track:", sender.track));
    peerConnection.getReceivers().forEach(receiver => console.log("Receiver track:", receiver.track));
  }, 3000);
}

async function hangUp() {
  if (peerConnection) {
    peerConnection.close();
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
  }

  localVideo.srcObject = null;
  remoteVideo.srcObject = null;

  const roomId = roomInput.value;
  if (roomId) {
    const db = firebase.firestore();
    const roomRef = db.collection("rooms").doc(roomId);

    const calleeCandidates = await roomRef.collection("calleeCandidates").get();
    calleeCandidates.forEach(async candidate => await candidate.ref.delete());

    const callerCandidates = await roomRef.collection("callerCandidates").get();
    callerCandidates.forEach(async candidate => await candidate.ref.delete());

    await roomRef.delete();
  }

  window.currentRoom = null;
}

openUserMedia();
