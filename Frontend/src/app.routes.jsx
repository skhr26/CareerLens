import { createBrowserRouter } from "react-router-dom";
import Login from "./features/auth/pages/Login";
import Register from "./features/auth/pages/Register";
import Protected from "./features/auth/components/Protected";
import Home from "./features/ai/Pages/Home";
import Interview from "./features/ai/Pages/Interview"


export const router = createBrowserRouter([
    {
        path: "/login",
        element: <Login />
    },
    {
        path: "/register",
        element: <Register />
    },
     {
        path: "/",
        element: <Protected><Home /></Protected>
    },
    {
        path:"/report/:interviewId",
        element: <Protected><Interview /></Protected>
    }
])