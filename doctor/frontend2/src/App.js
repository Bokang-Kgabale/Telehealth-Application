import React, { useState } from 'react';
import './App.css';

const App = () => {
    const [showStream, setShowStream] = useState(false);
    const [capturedData, setCapturedData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState(""); // Room ID

    const toggleLiveStream = async () => {
        setShowStream(!showStream);

        if (!showStream) {
            try {
                await fetch('http://127.0.0.1:8001/start-server');
            } catch (error) {
                console.error('Error starting live stream server:', error);
            }
        }
    };

    const fetchCapturedData = async () => {
        if (!searchQuery.trim()) {
            alert("Please enter a Room ID.");
            return;
        }

        setLoading(true);
        try {
            const response = await fetch(`http://127.0.0.1:8000/api/get-captured-data?roomId=${encodeURIComponent(searchQuery)}`);
            const data = await response.json();

            if (response.ok) {
                setCapturedData(data.data);
            } else {
                console.error(data.error);
                setCapturedData(null);
            }
        } catch (error) {
            console.error('Error fetching captured data:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="app-container">
            <header className="app-header">
                <h1>Telehealth Doctor Dashboard</h1>
            </header>

            <div className="main-content">
                <div className="sidebar">
                    <h3>Actions</h3>
                    <div className="button-group">
                        <button onClick={toggleLiveStream} className={`button stream-btn ${showStream ? 'active' : ''}`}>
                            <i className="icon stream-icon"></i>
                            {showStream ? 'Stop Live Stream' : 'Start Live Stream'}
                        </button>
                    </div>
                </div>

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

                <div className="results-panel">
                    <h3>Patient Vitals</h3>

                    <div className="search-section">
                        <input
                            type="text"
                            className="search-input"
                            placeholder="Enter Room ID (e.g. ROOM123)..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        <button className="button search-btn" onClick={fetchCapturedData}>
                            Search
                        </button>
                    </div>

                    <div className="results-content">
                        {loading ? (
                            <div className="loading-indicator">
                                <div className="spinner"></div>
                            </div>
                        ) : capturedData ? (
                            <div className="data-cards">
                                {capturedData.temperature && (
                                    <div className="data-card temperature-card spaced-card">
                                        <h4>Temperature Data</h4>
                                        <div className="data-value">{capturedData.temperature.formatted_value}</div>
                                        <div className="data-raw">Raw: {capturedData.temperature.raw_text}</div>
                                    </div>
                                )}
                                {capturedData.weight && (
                                    <div className="data-card weight-card spaced-card">
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
