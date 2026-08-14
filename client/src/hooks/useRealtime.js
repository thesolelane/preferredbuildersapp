import { useEffect } from 'react';

// Use require() instead of static import so webpack does NOT scope-hoist
// socket.io-client into the same chunk as the rest of the app.
// Static import of io() was causing a TDZ crash (class initialization order
// issue) in the production scope-hoisted bundle after module graph changes.
let socket = null;
function getSocket() {
  if (!socket) {
    const { io } = require('socket.io-client'); // eslint-disable-line
    socket = io();
  }
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
