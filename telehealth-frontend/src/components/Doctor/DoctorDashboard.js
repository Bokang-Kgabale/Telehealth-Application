import React, { useState, useEffect } from 'react';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getDatabase, ref, onValue, off } from 'firebase/database';
import './DoctorDashboard.css';

const DoctorDashboard = () => {
    const [currentCity, setCurrentCity] = useState("CPT");
    const [showStream, setShowStream] = useState(false);
    const [capturedData, setCapturedData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [doctorName, setDoctorName] = useState("");
    const [patientQueue, setPatientQueue] = useState([]);
    const [availableCities] = useState([
        { code: "CPT", name: "Cape Town Hub" },
        { code: "JHB", name: "Johannesburg Base" }
    ]);

    // Fetch doctor's name on component mount
    useEffect(() => {
        const fetchDoctorName = async () => {
            try {
                const auth = getAuth();
                const user = auth.currentUser;
                if (user) {
                    const db = getFirestore();
                    const doctorRef = doc(db, 'doctors', user.uid);
                    const doctorSnap = await getDoc(doctorRef);
                    if (doctorSnap.exists()) {
                        setDoctorName(doctorSnap.data().fullName || "");
                    }
                }
            } catch (error) {
                console.error("Error fetching doctor data:", error);
            }
        };
        fetchDoctorName();
    }, []);

    // Monitor queue when city changes
    // Monitor queue when city changes
useEffect(() => {
    const db = getDatabase();
    const queueRef = ref(db, `patients/${currentCity}`);
    
    // Set up realtime listener
    const handleSnapshot = (snapshot) => {
        const patients = [];
        snapshot.forEach((childSnapshot) => {
            patients.push({
                id: childSnapshot.key,
                ...childSnapshot.val()
            });
        });
        
        // Sort by creation time (oldest first)
        patients.sort((a, b) => a.createdAt - b.createdAt);
        setPatientQueue(patients);
    };

    // Subscribe to changes
    onValue(queueRef, handleSnapshot);

    // Cleanup function
    return () => {
        off(queueRef, handleSnapshot);
    };
}, [currentCity]);

    const toggleLiveStream = async () => {
        setShowStream(!showStream);        
    };

    const fetchCapturedData = async () => {
        if (!searchQuery.trim()) {
            alert("Please enter a Room ID.");
            return;
        }

        setLoading(true);
        try {
            const response = await fetch(`https://ocr-backend-application.onrender.com/api/get-data/?roomId=${encodeURIComponent(searchQuery)}`);
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

    // Format wait time
    const formatWaitTime = (timestamp) => {
        if (!timestamp) return '';
        const minutes = Math.floor((Date.now() - timestamp) / 60000);
        return `${minutes} min`;
    };

    return (
        <div className="app-container">
            <header className="app-header">
                <h1>
                    Medical Data Capture System - {availableCities.find(c => c.code === currentCity)?.name}
                    {doctorName && <span className="doctor-name-header"> - Dr. {doctorName}</span>}
                </h1>
                <div className="location-selector">
                    <select 
                        value={currentCity} 
                        onChange={(e) => setCurrentCity(e.target.value)}
                    >
                        {availableCities.map((city) => (
                            <option key={city.code} value={city.code}>
                                {city.name} ({patientQueue.length})
                            </option>
                        ))}
                    </select>
                </div>
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

                    <div className="queue-section">
                        <h4>Current Queue ({patientQueue.length})</h4>
                        <ul>
                            {patientQueue.map((patient, index) => (
                                <li key={patient.id} className={`patient-item ${patient.status}`}>
                                    <span className="patient-id">
                                        {index + 1}. {patient.id}
                                        {patient.status === 'in_consultation' && 
                                         <span className="status-badge">In Session</span>}
                                    </span>
                                    <span className="wait-time">
                                        {formatWaitTime(patient.createdAt)}
                                    </span>
                                </li>
                            ))}
                        </ul>
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
                                <i className="icon camera-icon2 large"></i>
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
                                placeholder="Search by Room ID..."
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