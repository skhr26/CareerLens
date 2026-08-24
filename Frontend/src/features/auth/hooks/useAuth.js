import { useContext, useEffect } from "react";
import { AuthContext } from "../auth.context"
import {login,logout,register,getMe} from '../services/auth.api'

export const useAuth = () => {
    const context = useContext(AuthContext)
    const { user, setUser, loading, setLoading } = context

    const handleLogin = async ({ email, password }) => {
        setLoading(true)
        try {
            const res = await login({ email, password })
            if (res && res.user) setUser(res.user)
            return res
        } catch (err) {
            console.log(err);
            throw err;
        } finally {
            setLoading(false)
        }
    }

    const handleRegister = async ({ username, email, password }) => {
        setLoading(true)
        try {
            const data = await register({ username, email, password })
            if (data && data.user) {
                setUser(data.user);
            }
            return data;
        } catch (err) {
            console.log("Register error:", err);
            throw err;
        } finally {
            setLoading(false)
        }
    }

    const handleLogout = async () => {
        setLoading(true)
        try {
            await logout()
            setUser(null)
        } catch (err) {
            console.log(err);
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        const getAndSetUser = async () => {
            try {
                const data = await getMe()
                setUser(data.user)
            } catch (err) { 
                console.log(err)
            } finally {
                setLoading(false)
            }
        }

        getAndSetUser()
    }, [])

    return { user, loading, handleRegister, handleLogin, handleLogout }
}