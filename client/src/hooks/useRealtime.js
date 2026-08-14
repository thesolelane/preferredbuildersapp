import { useEffect } from 'react';
import { io } from 'socket.io-client';

// Lazy singleton — defer io() until first use so module init order doesn't matter
let socket = null;
function getSocket() {
  if (!socket) socket = io();
  return socket;
}

export default function useRealtime(jobId, onUpdate) {
  useEffect(() => {
    if (!jobId) return;

    const s = getSocket();
    s.emit('join-job', jobId);

    const handleUpdate = (data) => {
      if (onUpdate) onUpdate(data);
    };

    s.on(`job:${jobId}`, handleUpdate);

    return () => {
      s.off(`job:${jobId}`, handleUpdate);
      s.emit('leave-job', jobId);
    };
  }, [jobId, onUpdate]);
}
