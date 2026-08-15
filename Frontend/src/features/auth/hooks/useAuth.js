import { useContext, useEffect } from "react";
import { AuthContext } from "../auth.context"
import {login,logout,register,getMe} from '../services/auth.api'

export const useAuth = () => {
  
  // so basically we first wrote the data wala part in the auth.context.js
  // file then we are now writing the logic in which we will use the auth data 

  // yha pe ui pe kaise logic perform honge wo baate hui hai

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
        } finally {
            setLoading(false)
        }
    }

    const handleRegister = async ({ username, email, password }) => {
        setLoading(true)
        try {
            const data = await register({ username, email, password })
            console.log(data);
            setUser(data.user)
        } catch (err) {
          console.log(err);

        } finally {
            setLoading(false)
        }
    }

    const handleLogout = async () => {
        setLoading(true)
        try {
            const data = await logout()
            setUser(null)
            // since the user has logged out so we are setting the user to null
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
    // jab bhi load hoga to user fetch ho jaayge ka logic 

    return { user, loading, handleRegister, handleLogin, handleLogout }
}