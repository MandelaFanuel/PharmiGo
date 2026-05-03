import { useEffect, useRef } from 'react';

const useWebSocket = (url: string, onMessage: (message: string) => void) => {
    const socketRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        socketRef.current = new WebSocket(url);

        socketRef.current.onmessage = (event) => {
            onMessage(event.data);
        };

        socketRef.current.onclose = () => undefined;

        return () => {
            socketRef.current?.close();
        };
    }, [url, onMessage]);

    const sendMessage = (message: string) => {
        if (socketRef.current) {
            socketRef.current.send(message);
        }
    };

    return { sendMessage };
};

export default useWebSocket;
