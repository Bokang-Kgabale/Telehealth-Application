import React, { useRef, useState, useEffect } from "react";
import Webcam from "react-webcam";

const CameraCapture = () => {
    const webcamRef = useRef(null);
    const [image, setImage] = useState(null);
    const [captureType, setCaptureType] = useState(null);
    const [cameraDeviceId, setCameraDeviceId] = useState(null);

    // Function to find an external camera if available
    useEffect(() => {
        navigator.mediaDevices.enumerateDevices()
            .then((devices) => {
                const videoDevices = devices.filter(device => device.kind === "videoinput");
                
                if (videoDevices.length > 1) {
                    // If multiple cameras exist, prioritize the external one
                    setCameraDeviceId(videoDevices[1].deviceId);
                } else {
                    // Otherwise, use the built-in camera
                    setCameraDeviceId(videoDevices[0]?.deviceId || null);
                }
            })
            .catch(error => console.error("Error detecting cameras:", error));
    }, []);

    // Function to capture image
    const captureImage = (type) => {
        if (webcamRef.current) {
            const imageSrc = webcamRef.current.getScreenshot();
            setImage(imageSrc);
            setCaptureType(type);
            sendImageToBackend(imageSrc, type);
        }
    };

    // Function to send image to Django backend
    const sendImageToBackend = async (imageSrc, type) => {
        try {
            const response = await fetch("http://127.0.0.1:8000/api/upload/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image: imageSrc, type }),
            });

            const data = await response.json();
            alert(`Captured ${type}: ${data.result}`);
        } catch (error) {
            console.error("Error uploading image:", error);
        }
    };

    return (
        <div style={{ textAlign: "center", padding: "20px" }}>
            <h2>Capture Data</h2>
            
            {cameraDeviceId ? (
                <Webcam
                    audio={false}
                    ref={webcamRef}
                    screenshotFormat="image/jpeg"
                    width={400}
                    height={300}
                    videoConstraints={{ deviceId: cameraDeviceId }}
                />
            ) : (
                <p>No camera detected</p>
            )}

            <div style={{ marginTop: "20px" }}>
                <button onClick={() => captureImage("temperature")} style={{ margin: "10px", padding: "10px" }}>
                    Capture Temperature
                </button>
                <button onClick={() => captureImage("weight")} style={{ margin: "10px", padding: "10px" }}>
                    Capture Weight
                </button>
                <button onClick={() => window.close()} style={{ margin: "10px", padding: "10px" }}>
                    Exit
                </button>
            </div>

            {image && (
                <div>
                    <h3>Captured {captureType}</h3>
                    <img src={image} alt="Captured" style={{ width: "300px", marginTop: "10px" }} />
                </div>
            )}
        </div>
    );
};

export default CameraCapture;
