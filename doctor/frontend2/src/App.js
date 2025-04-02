import React, { useState, useEffect } from 'react';
import './App.css';

const App = () => {
    const [showStream, setShowStream] = useState(false);
    const [roomId, setRoomId] = useState(''); // Room ID from the video call app
    const [capturedData, setCapturedData] = useState(null); // State to store captured data

    const toggleLiveStream = async () => {
        setShowStream(!showStream);

        if (!showStream) {
            // Start the video conferencing server on port 8001
            try {
                await fetch('http://127.0.0.1:8001/start-server'); // Updated to match iframe port
            } catch (error) {
                console.error('Error starting live stream server:', error);
            }
        }
    };

    const fetchCapturedData = async (roomId) => {
        try {
            const response = await fetch(`http://127.0.0.1:8000/api/get-data/${roomId}/`);
            const data = await response.json();

            if (data.error) {
                console.error('Error fetching data:', data.error);
                return;
            }

            console.log('Captured data:', data);
            setCapturedData(data.data); // Update the state with the fetched data
        } catch (error) {
            console.error('Error fetching captured data:', error);
        }
    };

    // Listen for the `roomId` from the video call app
    useEffect(() => {
        const detectRoomId = () => {
            const roomElement = document.getElementById('currentRoom');
            if (roomElement && roomElement.innerText.includes('Room ID:')) {
                const detectedRoomId = roomElement.innerText.split('Room ID: ')[1];
                if (detectedRoomId && detectedRoomId !== roomId) {
                    setRoomId(detectedRoomId); // Update the roomId state
                }
            }
        };

        // Poll for changes in the `roomId` every second
        const interval = setInterval(detectRoomId, 1000);

        return () => clearInterval(interval); // Cleanup the interval on component unmount
    }, [roomId]);

    // Fetch captured data whenever the `roomId` changes
    useEffect(() => {
        if (roomId) {
            fetchCapturedData(roomId);
        }
    }, [roomId]);

    return (
        <div className="app-container">
            {/* Header */}
            <header className="app-header">
                <h1>Telehealth Doctor Dashboard</h1>
                <p>Room ID: {roomId || 'Not detected'}</p>
            </header>

            <div className="main-content">
                {/* Sidebar buttons */}
                <div className="sidebar">
                    <h3>Actions</h3>
                    <div className="button-group">
                        <button onClick={toggleLiveStream} className={`button stream-btn ${showStream ? 'active' : ''}`}>
                            <i className="icon stream-icon"></i>
                            {showStream ? 'Stop Live Stream' : 'Start Live Stream'}
                        </button>
                    </div>
                </div>

                {/* Main Live Stream Section */}
                <div className="camera-container">
                    {showStream ? (
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
                                <h2>Start a Live Stream</h2>
                                <p>Use the button on the left to start the live stream</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Captured Data Section */}
                <div className="results-panel">
                    <h3>Patient Vitals</h3>
                    <div className="results-content">
                        {capturedData ? (
                            <div className="data-cards">
                                {capturedData.temperature && (
                                    <div className="data-card temperature-card">
                                        <h4>Temperature Data</h4>
                                        <div className="data-value">{capturedData.temperature.formatted_value}</div>
                                        <div className="data-raw">Raw: {capturedData.temperature.raw_text}</div>
                                    </div>
                                )}
                                {capturedData.weight && (
                                    <div className="data-card weight-card">
                                        <h4>Weight Data</h4>
                                        <div className="data-value">{capturedData.weight.formatted_value}</div>
                                        <div className="data-raw">Raw: {capturedData.weight.raw_text}</div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="no-data">
                                <p>No data received yet</p>
                                <p>Waiting for captured data...</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;