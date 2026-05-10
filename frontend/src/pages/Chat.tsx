import { Navigate } from "react-router-dom";

export default function Chat() {
  return <Navigate to="/?modal=messages" replace />;
}
