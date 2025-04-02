import React, { useRef, useState, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import './App.css';

const App = () => {
    const webcamRef = useRef(null);
    const [showCamera, setShowCamera] = useState(false);
    const [showStream, setShowStream] = useState(false);
    const [capturedImage, setCapturedImage] = useState(null);
    const [mode, setMode] = useState(null);
    const [temperatureDeviceId, setTemperatureDeviceId] = useState('');
    const [weightDeviceId, setWeightDeviceId] = useState('');
    const [timer, setTimer] = useState(5);
    const [cameraReady, setCameraReady] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);

    // Store extracted data separately for temperature & weight
    const [temperatureData, setTemperatureData] = useState(null);
    const [weightData, setWeightData] = useState(null);

    const refreshDevices = useCallback(() => {
        navigator.mediaDevices.enumerateDevices()
            .then(devices => {
                const videoDevices = devices.filter(device => device.kind === 'videoinput');

                if (videoDevices.length > 0) {
                    setTemperatureDeviceId(videoDevices[0].deviceId);
                }
                if (videoDevices.length > 1) {
                    setWeightDeviceId(videoDevices[1].deviceId);
                }
            })
            .catch(error => console.error('Error enumerating devices:', error));
    }, []);

    useEffect(() => {
        refreshDevices();
    }, [refreshDevices]);

    const openTemperatureCamera = () => {
        setMode('temperature');
        setShowCamera(true);
        setShowStream(false);
        resetState();
    };

    const openWeightCamera = () => {
        setMode('weight');
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
            // Start the video conferencing server on port 8001
            try {
                await fetch('http://127.0.0.1:8001/start-server'); // Updated to match iframe port
            } catch (error) {
                console.error('Error starting live stream server:', error);
            }
        }
    };

    const exitCamera = () => {
        setShowCamera(false);
        setShowStream(false);
        setMode(null);
        resetState();
    };

    const resetState = () => {
        setCapturedImage(null);
        setTimer(5);
        setCameraReady(false);
        setIsCapturing(false);
    };

    const captureImage = useCallback(() => {
        if (webcamRef.current) {
            const imageSrc = webcamRef.current.getScreenshot();
            setCapturedImage(imageSrc);
            setShowCamera(false);
            setIsCapturing(false);
            uploadImage(imageSrc, mode);
        }
    }, [mode]);

    useEffect(() => {
        if (showCamera && timer > 0 && cameraReady && !isCapturing) {
            const timerId = setInterval(() => {
                setTimer(prev => prev - 1);
                if (timer === 1) {
                    setIsCapturing(true);
                    captureImage();
                    clearInterval(timerId);
                }
            }, 1000);

            return () => clearInterval(timerId);
        }
    }, [showCamera, timer, captureImage, cameraReady, isCapturing]);

    const handleOnReady = () => {
        setCameraReady(true);
    };

    const uploadImage = async (imageSrc, type) => {
        try {
            const blob = await fetch(imageSrc).then(res => res.blob());
            const formData = new FormData();
            formData.append('image', blob, `${type}.jpg`);
            formData.append('type', type);

            const response = await fetch('http://127.0.0.1:8000/api/upload/', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();
            console.log(`${type} Capture Response:`, data);

            // Store extracted data separately
            if (type === 'temperature') {
                setTemperatureData(data);
            } else if (type === 'weight') {
                setWeightData(data);
            }
        } catch (error) {
            console.error('Error uploading image:', error);
        }
    };

    return (
        <div className="app-container">
            {/* Header */}
            <header className="app-header">
                <h1>Telehealth Medical Data Capture System</h1>
                {mode && <h2 className={`mode-indicator ${mode}`}>Mode: {mode.charAt(0).toUpperCase() + mode.slice(1)}</h2>}
            </header>

            <div className="main-content">
                {/* Sidebar buttons */}
                <div className="sidebar">
                    <h3>Actions</h3>
                    <div className="button-group">
                        <button onClick={openTemperatureCamera} className="button temperature-btn">
                            <i className="icon temperature-icon"></i>
                            Capture Temperature
                        </button>
                        <button onClick={openWeightCamera} className="button weight-btn">
                            <i className="icon weight-icon"></i>
                            Capture Weight
                        </button>
                        <button onClick={toggleLiveStream} className={`button stream-btn ${showStream ? 'active' : ''}`}>
                            <i className="icon stream-icon"></i>
                            {showStream ? 'Stop Live Stream' : 'Start Live Stream'}
                        </button>
                        <button onClick={exitCamera} className="button exit-btn">
                            <i className="icon exit-icon"></i>
                            Exit
                        </button>
                    </div>
                </div>

                {/* Main Camera/Live Stream Section */}
                <div className="camera-container">
                    {showCamera ? (
                        <div className="camera-view">
                            <div className="timer-display">
                                <span className="timer-circle">{timer}</span>
                                <p>Automatically capturing in {timer} seconds</p>
                            </div>
                            <Webcam
                                ref={webcamRef}
                                screenshotFormat='image/jpeg'
                                className="webcam"
                                videoConstraints={{
                                    deviceId: mode === 'temperature' ? temperatureDeviceId : weightDeviceId,
                                    facingMode: "user",
                                }}
                                onUserMedia={handleOnReady}
                            />
                            <div className="camera-controls">
                                <button onClick={exitCamera} className="button exit-btn">
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : showStream ? (
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
                    ) : (
                        <div className="empty-state">
                            <div className="empty-content">
                                <i className="icon camera-icon large"></i>
                                <h2>Select an option to start</h2>
                                <p>Use the buttons on the left to capture temperature, weight, or start a live stream</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Captured Image & Data Display */}
                <div className="results-panel">
                    <h3>Captured Data</h3>
                    
                    <div className="results-content">
                        {capturedImage && (
                            <div className="captured-image-container">
                                <h4>Last Captured Image:</h4>
                                <img src={capturedImage} alt='Captured' className="captured-image" />
                                <p className="caption">Captured {mode} data</p>
                            </div>
                        )}

                        {/* Persistent Extracted Data Display */}
                        {(temperatureData || weightData) && (
                            <div className="extracted-data">
                                {temperatureData && (
                                    <div className="data-card temperature-card">
                                        <h4>Temperature Data</h4>
                                        <div className="data-value">{temperatureData.formatted_value}</div>
                                        <div className="data-raw">Raw: {temperatureData.raw_text}</div>
                                    </div>
                                )}

                                {weightData && (
                                    <div className="data-card weight-card">
                                        <h4>Weight Data</h4>
                                        <div className="data-value">{weightData.formatted_value}</div>
                                        <div className="data-raw">Raw: {weightData.raw_text}</div>
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {!capturedImage && !temperatureData && !weightData && (
                            <div className="no-data">
                                <p>No data captured yet</p>
                                <p>Use the camera buttons to start capturing</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;