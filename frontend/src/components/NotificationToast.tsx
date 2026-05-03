interface NotificationToastProps {
  message: string;
}

export default function NotificationToast({ message }: NotificationToastProps) {
  return <div className="notification-toast">{message}</div>;
}
