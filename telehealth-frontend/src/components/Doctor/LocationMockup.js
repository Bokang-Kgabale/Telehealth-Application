const locations = {
  "CT": {
    name: "Cape Town Hub",
    queue: ["#a3f5b2", "#c9d8e1"],
    doctors: ["Dr. Khumalo"],
    terminals: ["CT-T1"]
  },
  "JHB": {
    name: "Johannesburg Base",
    queue: ["#f2a1e6"],
    doctors: [],
    terminals: ["JHB-T1"]
  }
};

export const getLocation = (id) => locations[id] || null;
export const simulatePatientJoin = (locId, patientUUID) => {
  locations[locId].queue.push(patientUUID);
};