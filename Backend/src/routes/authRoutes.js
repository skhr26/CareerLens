const express=require("express");
const {register,login}=require('../controller/authController')

const router=express.Router();
  

// api/auth.regiter
router.post("/register",register);
router.post("/login",login);



module.exports=router