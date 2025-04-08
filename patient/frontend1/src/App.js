import React, { useRef, useState, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import './App.css';

const App = () => {
    const webcamRef = useRef(null);
    const [showCamera, setShowCamera] = useState(false);
    const [showStream, setShowStream] = useState(false);
    const [capturedImages, setCapturedImages] = useState({
        temperature: null,
        weight: null
    });
    const [mode, setMode] = useState(null);
    const [cameraDeviceId, setCameraDeviceId] = useState('');
    const [timer, setTimer] = useState(5);
    const [cameraReady, setCameraReady] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const [activeCapture, setActiveCapture] = useState(null);

    const [capturedData, setCapturedData] = useState({
        temperature: null,
        weight: null
    });

    const [roomId, setRoomId] = useState('');
    const [showRoomIdModal, setShowRoomIdModal] = useState(false);
    const [pendingCaptureType, setPendingCaptureType] = useState(null);

    const refreshDevices = useCallback(() => {
        navigator.mediaDevices.enumerateDevices()
            .then(devices => {
                const videoDevices = devices.filter(device => device.kind === 'videoinput');
                if (videoDevices.length > 0) {
                    setCameraDeviceId(videoDevices[0].deviceId);
                }
            })
            .catch(error => console.error('Error enumerating devices:', error));
    }, []);

    useEffect(() => {
        refreshDevices();
    }, [refreshDevices]);

    const openCaptureWindow = () => {
        setMode('capture');
        setShowCamera(true);
        setShowStream(false);
        resetState();
    };

    const toggleLiveStream = async () => {
        setMode(mode === 'stream' ? null : 'stream');
        setShowStream(!showStream);
        setShowCamera(false);
        resetState();

        if (!showStream) {
            try {
                await fetch('http://127.0.0.1:8001/start-server');
            } catch (error) {
                console.error('Error starting live stream server:', error);
            }
        }
    };

    const exitCamera = () => {
        setShowCamera(false);
        setShowStream(false);
        setMode(null);
        setTimer(5); // Reset timer, if necessary
        setCameraReady(false);
        setIsCapturing(false);
        setActiveCapture(null);
    };

    const resetState = () => {
        setTimer(5);
        setCameraReady(false);
        setIsCapturing(false);
        setActiveCapture(null);
    };

    // Move the uploadImage function here, before it's used
    const uploadImage = useCallback(async (imageSrc, type) => {
        try {
            const blob = await fetch(imageSrc).then(res => res.blob());
            const formData = new FormData();
            formData.append('image', blob, `${type}.jpg`);
            formData.append('type', type);
            formData.append('roomId', roomId);  // ✅ Add roomId to upload
    
            const response = await fetch('http://127.0.0.1:8000/api/upload/', {
                method: 'POST',
                body: formData,
            });
    
            const data = await response.json();
            setCapturedData(prev => ({ ...prev, [type]: data }));
            setIsCapturing(false);
        } catch (error) {
            console.error('Error uploading image:', error);
            setIsCapturing(false);
        }
    }, [roomId]);  // ✅ Declare roomId as dependency

    const captureImage = useCallback((type) => {
        if (webcamRef.current && !isCapturing) {
            setIsCapturing(true);
            setActiveCapture(type);
            const imageSrc = webcamRef.current.getScreenshot();
            setCapturedImages(prev => ({ ...prev, [type]: imageSrc }));
            uploadImage(imageSrc, type);
        }
    }, [isCapturing, uploadImage]);

    useEffect(() => {
        if (showCamera && timer > 0 && cameraReady && activeCapture && !isCapturing) {
            const timerId = setInterval(() => {
                setTimer(prev => prev - 1); // Decrement the timer every second
            }, 1000);
    
            // When the timer reaches 0, capture the image and close the camera
            if (timer === 1) {
                captureImage(activeCapture);
                clearInterval(timerId);
                exitCamera(); // Close the camera after capture
            }
    
            return () => clearInterval(timerId); // Clear interval when component unmounts or dependencies change
        }
    }, [showCamera, timer, activeCapture, cameraReady, isCapturing, captureImage]);
    

    const handleOnReady = () => {
        setCameraReady(true);
    };

    const startSession = () => {
        setMode('session');
        setShowCamera(true);
        setShowStream(true);
        resetState();
        toggleLiveStream();
        openCaptureWindow();
    };

    const handleConfirmRoomId = () => {
        if (roomId.trim()) {
            setShowRoomIdModal(false);
            console.log("Pending Capture Type:", pendingCaptureType); // Debugging line to verify type
            setActiveCapture(pendingCaptureType); // Set activeCapture based on pendingCaptureType
            setTimer(5); // Reset the timer
            console.log("Active Capture after confirmation:", pendingCaptureType); // Verify state change
        }
    };

    const handleCapture = (type) => {
        console.log("Setting capture type to:", type); // Debugging line
        setPendingCaptureType(type);
        setShowRoomIdModal(true); // Open the modal
    };

    return (
        <div className="app-container">
            <header className="app-header">
                <h1>Medical Data Capture System</h1>
                {mode && <h2 className={`mode-indicator ${mode}`}>Mode: {mode.charAt(0).toUpperCase() + mode.slice(1)}</h2>}
            </header>

            <div className="main-content">
                <div className="sidebar">
                    <h3>Actions</h3>
                    <div className="button-group">
                        <button onClick={startSession} className="button start-session-btn">
                            <i className="icon stream-icon"></i>
                            Capture Vitals
                        </button>                        
                        <button onClick={exitCamera} className="button exit-btn">
                            <i className="icon exit-icon"></i>
                            Exit
                        </button>
                    </div>
                </div>

                <div className="camera-container">
                    <div className="camera-view">
                        <div className="capture-controls">
                            <button 
                                onClick={() => handleCapture('temperature')}
                                className={`capture-type-btn ${activeCapture === 'temperature' ? 'active' : ''}`}
                            >
                                Capture Temperature
                            </button>
                            <button 
                                onClick={() => handleCapture('weight')}
                                className={`capture-type-btn ${activeCapture === 'weight' ? 'active' : ''}`}
                            >
                                Capture Weight
                            </button>
                        </div>

                        {/* Show webcam only if activeCapture is set */}
                        {activeCapture && (
                            <div className="compact-camera-container">
                                {activeCapture && (
                                    <div className="timer-display">
                                        <span className="timer-circle">{timer}</span>
                                        <p>Capturing {activeCapture} in {timer} seconds</p>
                                    </div>
                                )}

                                <Webcam
                                    ref={webcamRef}
                                    screenshotFormat="image/jpeg"
                                    className="compact-webcam"
                                    videoConstraints={{
                                        deviceId: cameraDeviceId,
                                        facingMode: 'user',
                                    }}
                                    onUserMedia={handleOnReady}
                                />
                            </div>
                        )}

                        <div className="camera-controls">
                            <button onClick={exitCamera} className="button exit-btn">
                                Close Capture
                            </button>
                        </div>
                    </div>

                    <div className="stream-view">
                        <iframe
                            src="http://127.0.0.1:8001/"
                            title="Video Conferencing"
                            width="100%"
                            height="500px"
                            style={{ border: 'none' }}
                            allow="camera; microphone"
                        ></iframe>
                    </div>

                    <div className="empty-state">                        
                    </div>
                </div>

                <div className="results-panel">
                    <h3>Captured Data</h3>
                    <div className="results-content">
                        {(capturedImages.temperature || capturedImages.weight) && (
                            <div className="captured-images-container">
                                {capturedImages.temperature && (
                                    <div className="captured-image-card">
                                        <h4>Temperature</h4>
                                        <img src={capturedImages.temperature} alt='Captured Temperature' className="captured-image" />
                                        {capturedData.temperature && (
                                            <div className="data-display">
                                                <div className="data-value">{capturedData.temperature.formatted_value}</div>
                                                <div className="data-raw">{capturedData.temperature.raw_text}</div>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {capturedImages.weight && (
                                    <div className="captured-image-card">
                                        <h4>Weight</h4>
                                        <img src={capturedImages.weight} alt='Captured Weight' className="captured-image" />
                                        {capturedData.weight && (
                                            <div className="data-display">
                                                <div className="data-value">{capturedData.weight.formatted_value}</div>
                                                <div className="data-raw">{capturedData.weight.raw_text}</div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {!capturedImages.temperature && !capturedImages.weight && (
                            <div className="no-data">
                                <p>No data captured yet</p>
                                <p>Open the capture window to begin</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Room ID Modal */}
            {showRoomIdModal && (
                <div className="modal-backdrop">
                    <div className="modal">
                        <h3>Enter Room ID</h3>
                        <input 
                            type="text" 
                            value={roomId} 
                            onChange={(e) => setRoomId(e.target.value)} 
                            placeholder="Room ID"
                        />
                        <div className="modal-buttons">
                            <button onClick={handleConfirmRoomId}>
                                Confirm
                            </button>
                            <button onClick={() => {
                                setShowRoomIdModal(false);
                                setRoomId('');
                                setPendingCaptureType(null);
                            }}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
