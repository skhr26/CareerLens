const express=require("express");
const {register,login,logout,getme}=require('../controller/authController')
const router=express.Router();
  const {authMiddleware}=require('../middleware/auth.middleware')

// api/auth.regiter
router.post("/register",register);
router.post("/login",login);

// now comes logging out which requires the 
// blackListing ka feature 
// right so you have to keep that thing in your head 

router.get("/logout",logout);
router.get("/get-me",authMiddleware,getme);


module.exports=router