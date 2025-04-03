import React, { useState, useEffect } from 'react';
import './App.css';

const App = () => {
    const [showStream, setShowStream] = useState(false);
    const [capturedData, setCapturedData] = useState(null); // State to store captured data
    const [loading, setLoading] = useState(true); // State to track loading

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

    const fetchCapturedData = async () => {
        setLoading(true); // Set loading to true when fetching starts
        try {
            const temperatureResponse = await fetch('https://fir-rtc-521a2-default-rtdb.firebaseio.com/data/temperature.json');
            const weightResponse = await fetch('https://fir-rtc-521a2-default-rtdb.firebaseio.com/data/weight.json');

            const temperatureData = await temperatureResponse.json();
            const weightData = await weightResponse.json();

            if (!temperatureData && !weightData) {
                console.error('No data found');
                return;
            }

            console.log('Temperature data:', temperatureData);
            console.log('Weight data:', weightData);

            // Combine the data into a single object
            const combinedData = {
                temperature: Object.values(temperatureData || {}),
                weight: Object.values(weightData || {}),
            };

            setCapturedData(combinedData); // Update the state with the combined data
        } catch (error) {
            console.error('Error fetching captured data:', error);
        } finally {
            setLoading(false); // Set loading to false when fetching is done
        }
    };

    // Fetch captured data when the component mounts
    useEffect(() => {
        fetchCapturedData();
    }, []);

    return (
        <div className="app-container">
            {/* Header */}
            <header className="app-header">
                <h1>Telehealth Doctor Dashboard</h1>
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
                        {loading ? (
                            <div className="loading-indicator">
                                <div className="spinner"></div>
                            </div>
                        ) : capturedData ? (
                            <div className="data-cards">
                                {capturedData.temperature.map((temp, index) => (
                                    <div key={index} className="data-card temperature-card spaced-card">
                                        <h4>Temperature Data</h4>
                                        <div className="data-value">{temp.formatted_value}</div>
                                        <div className="data-raw">Raw: {temp.raw_text}</div>
                                    </div>
                                ))}
                                {capturedData.weight.map((wt, index) => (
                                    <div key={index} className="data-card weight-card spaced-card">
                                        <h4>Weight Data</h4>
                                        <div className="data-value">{wt.formatted_value}</div>
                                        <div className="data-raw">Raw: {wt.raw_text}</div>
                                    </div>
                                ))}
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