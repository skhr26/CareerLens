import { useAuth } from "../hooks/useAuth";
import { Navigate } from "react-router";
import React from 'react'
const Protected = ({children}) => {
  // ye ek tarah se frontend ka middle ware hai jo hame agar user nhi mila to aage nhi badhne dega 


  // we will use it wherever we will find that things person muust login before they access
    const { loading,user } = useAuth()
    
    if(loading){
        return (<main><h1>Loading...</h1></main>)
    }

    if(!user){
        return <Navigate to={'/login'} />
    }
    
    return children
}

export default Protected