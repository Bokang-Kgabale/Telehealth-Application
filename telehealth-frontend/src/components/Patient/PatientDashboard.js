import React, { useRef, useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import Webcam from "react-webcam";
import "./PatientDashboard.css";

const PatientDashboard = () => {
  // Get patient UUID from navigation state or session storage
  const { state } = useLocation();
  const patientId =
    state?.patientId || sessionStorage.getItem("currentPatientId");

  const webcamRef = useRef(null);
  const [showCamera, setShowCamera] = useState(false);
  const [showStream, setShowStream] = useState(false);
  const [capturedImages, setCapturedImages] = useState({
    temperature: null,
    weight: null,
  });
  const [mode, setMode] = useState(null);
  const [cameraDevices, setCameraDevices] = useState([]);
  const [selectedCameras, setSelectedCameras] = useState({
    temperature: "",
    weight: "",
  });
  const [timer, setTimer] = useState(5);
  const [cameraReady, setCameraReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [activeCapture, setActiveCapture] = useState(null);
  const [capturedData, setCapturedData] = useState({
    temperature: null,
    weight: null,
  });
  const [roomId, setRoomId] = useState("");
  const [showRoomIdModal, setShowRoomIdModal] = useState(false);
  const [pendingCaptureType, setPendingCaptureType] = useState(null);
  const [cameraSelectionModal, setCameraSelectionModal] = useState(false);

  const refreshDevices = useCallback(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const videoDevices = devices.filter(
          (device) => device.kind === "videoinput"
        );
        setCameraDevices(videoDevices);

        if (videoDevices.length > 0) {
          const temperatureCamera = videoDevices[0].deviceId;
          const weightCamera =
            videoDevices.length > 1
              ? videoDevices[1].deviceId
              : videoDevices[0].deviceId;

          setSelectedCameras({
            temperature: temperatureCamera,
            weight: weightCamera,
          });
        }
      })
      .catch((error) => console.error("Error enumerating devices:", error));
  }, []);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  const openCaptureWindow = () => {
    setMode("capture");
    setShowCamera(true);
    setShowStream(false);
    resetState();
  };

  const toggleLiveStream = async () => {
    setMode(mode === "stream" ? null : "stream");
    setShowStream(!showStream);
    setShowCamera(false);
    resetState();
  };

  const exitCamera = () => {
    setShowCamera(false);
    setShowStream(false);
    setMode(null);
    setTimer(5);
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

  const uploadImage = useCallback(
    async (imageSrc, type) => {
      try {
        const blob = await fetch(imageSrc).then((res) => res.blob());
        const formData = new FormData();
        formData.append("image", blob, `${type}.jpg`);
        formData.append("type", type);
        formData.append("roomId", roomId);

        const response = await fetch(
          "https://ocr-backend-application.onrender.com/api/upload/",
          {
            method: "POST",
            body: formData,
          }
        );

        const data = await response.json();
        setCapturedData((prev) => ({ ...prev, [type]: data }));
        setIsCapturing(false);
      } catch (error) {
        console.error("Error uploading image:", error);
        setIsCapturing(false);
      }
    },
    [roomId]
  );

  const captureImage = useCallback(
    (type) => {
      if (webcamRef.current && !isCapturing) {
        setIsCapturing(true);
        setActiveCapture(type);
        const imageSrc = webcamRef.current.getScreenshot();
        setCapturedImages((prev) => ({ ...prev, [type]: imageSrc }));
        uploadImage(imageSrc, type);
      }
    },
    [isCapturing, uploadImage]
  );

  useEffect(() => {
    if (
      showCamera &&
      timer > 0 &&
      cameraReady &&
      activeCapture &&
      !isCapturing
    ) {
      const timerId = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);

      if (timer === 1) {
        captureImage(activeCapture);
        clearInterval(timerId);
        exitCamera();
      }

      return () => clearInterval(timerId);
    }
  }, [
    showCamera,
    timer,
    activeCapture,
    cameraReady,
    isCapturing,
    captureImage,
  ]);

  const handleOnReady = () => {
    setCameraReady(true);
  };

  const startSession = () => {
    setMode("session");
    setShowCamera(true);
    setShowStream(true);
    resetState();
    toggleLiveStream();
    openCaptureWindow();
  };

  const handleConfirmRoomId = () => {
    if (roomId.trim()) {
      setShowRoomIdModal(false);
      setActiveCapture(pendingCaptureType);
      setTimer(5);
    }
  };

  const handleCapture = (type) => {
    setPendingCaptureType(type);

    if (cameraDevices.length > 1) {
      setCameraSelectionModal(true);
    } else {
      setShowRoomIdModal(true);
    }
  };

  const handleCameraSelection = (deviceId) => {
    if (pendingCaptureType) {
      setSelectedCameras((prev) => ({
        ...prev,
        [pendingCaptureType]: deviceId,
      }));
      setCameraSelectionModal(false);
      setShowRoomIdModal(true);
    }
  };

  const getCurrentCameraId = () => {
    return activeCapture ? selectedCameras[activeCapture] : "";
  };

  const getCameraName = (deviceId) => {
    const device = cameraDevices.find((d) => d.deviceId === deviceId);
    return device
      ? device.label || `Camera ${cameraDevices.indexOf(device) + 1}`
      : "Unknown Camera";
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>
          Medical Data Capture System - Patient Dashboard -
          {patientId && (
            <span className="patient-id-header"> {patientId}</span>
          )}
        </h1>
        {mode && (
          <h2 className={`mode-indicator ${mode}`}>
            Mode: {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </h2>
        )}
      </header>

      <div className="main-content">
        <div className="sidebar">
          <h3>Actions</h3>
          <div className="button-group">
            <button onClick={startSession} className="button start-session-btn">
              <i className="icon stream-icon"></i>
              Capture Vitals
            </button>

            <button
              onClick={() => setCameraSelectionModal(true)}
              className="button camera-settings-btn"
            >
              <i className="icon camera-icon"></i>
              Camera Settings
            </button>
          </div>

          <div className="camera-info">
            <h4>Camera Assignments:</h4>
            <div className="camera-list">
              <p>
                <strong>Temperature:</strong>{" "}
                {getCameraName(selectedCameras.temperature)}
              </p>
              <p>
                <strong>Weight:</strong> {getCameraName(selectedCameras.weight)}
              </p>
            </div>
            <div className="camera-count">
              <p>{cameraDevices.length} camera(s) detected</p>
              <button onClick={refreshDevices} className="refresh-btn">
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div className="camera-container">
          <div className="camera-view">
            <div className="capture-controls">
              <button
                onClick={() => handleCapture("temperature")}
                className={`capture-type-btn ${
                  activeCapture === "temperature" ? "active" : ""
                }`}
              >
                Capture Temperature
              </button>
              <button
                onClick={() => handleCapture("weight")}
                className={`capture-type-btn ${
                  activeCapture === "weight" ? "active" : ""
                }`}
              >
                Capture Weight
              </button>
            </div>

            {activeCapture && (
              <div className="compact-camera-container">
                {activeCapture && (
                  <div className="timer-display">
                    <span className="timer-circle">{timer}</span>
                    <p>
                      Capturing {activeCapture} in {timer} seconds
                    </p>
                    <p className="camera-label">
                      Using: {getCameraName(selectedCameras[activeCapture])}
                    </p>
                  </div>
                )}

                <Webcam
                  ref={webcamRef}
                  screenshotFormat="image/jpeg"
                  className="compact-webcam"
                  videoConstraints={{
                    deviceId: getCurrentCameraId(),
                    facingMode: "user",
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
              src="https://telehealth-application.onrender.com/"
              title="Video Conferencing"
              width="100%"
              height="500px"
              style={{ border: "none" }}
              allow="camera; microphone"
            ></iframe>
          </div>

          <div className="empty-state"></div>
        </div>

        <div className="results-panel">
          <h3>Patient Vitals</h3>
          <div className="results-content">
            {(capturedImages.temperature || capturedImages.weight) && (
              <div className="captured-images-container">
                {capturedImages.temperature && (
                  <div className="captured-image-card">
                    <h4>Temperature</h4>
                    <img
                      src={capturedImages.temperature}
                      alt="Captured Temperature"
                      className="captured-image"
                    />
                    <p className="camera-info">
                      Captured with:{" "}
                      {getCameraName(selectedCameras.temperature)}
                    </p>
                    {capturedData.temperature && (
                      <div className="data-display">
                        <div className="data-value">
                          {capturedData.temperature.formatted_value}
                        </div>
                        <div className="data-raw">
                          {capturedData.temperature.raw_text}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {capturedImages.weight && (
                  <div className="captured-image-card">
                    <h4>Weight</h4>
                    <img
                      src={capturedImages.weight}
                      alt="Captured Weight"
                      className="captured-image"
                    />
                    <p className="camera-info">
                      Captured with: {getCameraName(selectedCameras.weight)}
                    </p>
                    {capturedData.weight && (
                      <div className="data-display">
                        <div className="data-value">
                          {capturedData.weight.formatted_value}
                        </div>
                        <div className="data-raw">
                          {capturedData.weight.raw_text}
                        </div>
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
              <button onClick={handleConfirmRoomId}>Confirm</button>
              <button
                onClick={() => {
                  setShowRoomIdModal(false);
                  setRoomId("");
                  setPendingCaptureType(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {cameraSelectionModal && (
        <div className="modal-backdrop">
          <div className="modal camera-modal">
            <h3>Select Camera for {pendingCaptureType || "Capture"}</h3>

            {cameraDevices.length > 0 ? (
              <div className="camera-options">
                {cameraDevices.map((device, index) => (
                  <button
                    key={device.deviceId}
                    className="camera-option-btn"
                    onClick={() => handleCameraSelection(device.deviceId)}
                  >
                    {device.label || `Camera ${index + 1}`}
                  </button>
                ))}
              </div>
            ) : (
              <p>No cameras detected. Please check your permissions.</p>
            )}

            <div className="modal-buttons">
              <button
                onClick={() => {
                  setCameraSelectionModal(false);
                  setPendingCaptureType(null);
                }}
              >
                Cancel
              </button>
              <button onClick={refreshDevices}>Refresh Cameras</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PatientDashboard;
