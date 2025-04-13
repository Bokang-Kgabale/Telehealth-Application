import React, { useState } from 'react';
import './DoctorDashboard.css';

const DoctorDashboard = () => {
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
            const response = await fetch(`http://127.0.0.1:8000/api/get-data/?roomId=${encodeURIComponent(searchQuery)}`);
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
                <h1>Medical Data Capture System - Doctor Dashboard</h1>
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
                                src="https://telehealth-application.onrender.com/"
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
                        <div className="search-container">
                            <input
                                type="text"
                                className="search-input"
                                placeholder="Search..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            <button className="search-button" onClick={fetchCapturedData}>
                                🔍
                            </button>
                        </div>
                    </div>

                    <div className="results-content">
                        {loading ? (
                            <div className="loading-indicator">
                                <div className="spinner"></div>
                            </div>
                        ) : capturedData ? (
                            <div className="data-cards">
                                {capturedData.temperature && capturedData.temperature.length > 0 && (
                                    <div className="data-card temperature-card spaced-card">
                                        <h4>Temperature Data</h4>
                                        <div className="data-value">{capturedData.temperature[0].formatted_value}</div>
                                        <div className="data-raw">Raw: {capturedData.temperature[0].raw_text}</div>
                                    </div>
                                )}
                                {capturedData.weight && capturedData.weight.length > 0 && (
                                    <div className="data-card weight-card spaced-card">
                                        <h4>Weight Data</h4>
                                        <div className="data-value">{capturedData.weight[0].formatted_value}</div>
                                        <div className="data-raw">Raw: {capturedData.weight[0].raw_text}</div>
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

export default DoctorDashboard;
