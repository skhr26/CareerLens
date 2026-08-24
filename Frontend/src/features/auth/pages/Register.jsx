import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const Register = () => {
    const navigate = useNavigate();
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");

    const { loading, handleRegister } = useAuth();
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");

        try {
            const data = await handleRegister({ username, email, password });
            if (data && data.user) {
                navigate("/");
            }
        } catch (err) {
            const serverMessage = err.response?.data?.message || "You have already registered! Please go and login now.";
            setError(serverMessage);
        }
    };

    if (loading) {
        return (<main><h1>Loading...</h1></main>);
    }

    return (
        <main>
            <div className="form-container">
                <h1>Register</h1>

                {error && (
                    <div style={{
                        backgroundColor: "rgba(255, 45, 120, 0.15)",
                        border: "1px solid #ff2d78",
                        color: "#ff7da7",
                        padding: "14px 18px",
                        borderRadius: "8px",
                        marginBottom: "20px",
                        fontSize: "0.98rem",
                        lineHeight: "1.5"
                    }}>
                        ⚠️ <strong>{error}</strong>
                        <div style={{ marginTop: "8px" }}>
                            <Link to="/login" style={{
                                display: "inline-block",
                                backgroundColor: "#ff2d78",
                                color: "#ffffff",
                                padding: "6px 14px",
                                borderRadius: "4px",
                                textDecoration: "none",
                                fontWeight: "bold",
                                fontSize: "0.9rem"
                            }}>
                                Click Here to Login &rarr;
                            </Link>
                        </div>
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div className="input-group">
                        <label htmlFor="username">Username</label>
                        <input
                            onChange={(e) => { setUsername(e.target.value); }}
                            type="text" id="username" name='username' placeholder='Enter username' required />
                    </div>
                    <div className="input-group">
                        <label htmlFor="email">Email</label>
                        <input
                            onChange={(e) => { setEmail(e.target.value); }}
                            type="email" id="email" name='email' placeholder='Enter email address' required />
                    </div>
                    <div className="input-group">
                        <label htmlFor="password">Password</label>
                        <input
                            onChange={(e) => { setPassword(e.target.value); }}
                            type="password" id="password" name='password' placeholder='Enter password' required />
                    </div>

                    <button className='button primary-button'>Register</button>
                </form>

                <p style={{ marginTop: "16px" }}>Already have an account? <Link to={"/login"}>Login</Link></p>
            </div>
        </main>
    );
};

export default Register;