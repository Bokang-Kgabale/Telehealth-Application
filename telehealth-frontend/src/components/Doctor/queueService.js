import { getDatabase, ref, onValue, off } from "firebase/database";

/**
 * Fetches and monitors the patient queue for a specific city
 * @param {string} cityCode - City code (e.g. "CPT", "JHB")
 * @param {function} callback - Function to receive queue updates
 * @returns {function} Unsubscribe function
 */
export const monitorCityQueue = (cityCode, callback) => {
  const db = getDatabase();
  const queueRef = ref(db, `patients/${cityCode}`);
  
  // Set up realtime listener
  onValue(queueRef, (snapshot) => {
    const patients = [];
    
    snapshot.forEach((childSnapshot) => {
      const patient = childSnapshot.val();
      patients.push({
        id: patient.id,
        city: patient.city,
        status: patient.status || 'waiting',
        createdAt: patient.createdAt,
        lastActive: patient.lastActive
      });
    });

    // Sort by creation time (oldest first)
    patients.sort((a, b) => a.createdAt - b.createdAt);
    
    callback(patients);
  });

  // Return unsubscribe function
  return () => off(queueRef);
};

/**
 * Get current queue snapshot (one-time read)
 */
export const getCityQueue = async (cityCode) => {
  const db = getDatabase();
  const queueRef = ref(db, `patients/${cityCode}`);
  
  const snapshot = await get(queueRef);
  if (!snapshot.exists()) return [];

  const patients = [];
  snapshot.forEach((childSnapshot) => {
    patients.push(childSnapshot.val());
  });
  
  return patients.sort((a, b) => a.createdAt - b.createdAt);
};