import React from 'react';
import './MessageNotification.css'; // We'll create this next

const MessageNotification = ({ currentMessage, assignedRoom }) => {
  return (
    <div className="message-notification">
      {currentMessage ? (
        <div className="alert alert-info">
          <h3>Doctor's Message</h3>
          <p>{currentMessage.content}</p>
          <p className="room-assignment">
            <strong>Room:</strong> {assignedRoom || 'Not assigned yet'}
          </p>
          <small>
            {new Date(currentMessage.timestamp).toLocaleTimeString()}
          </small>
        </div>
      ) : (
        <div className="alert alert-waiting">
          <p>Waiting for doctor's instructions...</p>
        </div>
      )}
    </div>
  );
};

export default MessageNotification;