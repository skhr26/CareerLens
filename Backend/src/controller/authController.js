const bcrypt=require('bcrypt');
const userModel=require('../models/UserModel')

const blackListModel=require("../models/blacklist")

const jwt=require("jsonwebtoken");

async function register(req,res) {
  const {username,email,password}=req.body;

  const exist=await userModel.findOne({
    // means to find the data on the basis of the username or email 
    $or: [
      {username},
      {email}
    ]
  })

  if(exist) {
    return res.status(403).json({
      message:"Account already exists with this email address or username"
    });
  }

  const hashedPassword=await bcrypt.hash(password,10);

  const user =await userModel.create({
    username,
    email,
    password:hashedPassword
  })

  const token=await jwt.sign({
    id:user._id,
    username:user.username
  },process.env.JWT,{expiresIn:"1d"});

  res.cookie("token",token);

  res.status(201).json({
    message:"Registered!",
    user: {
      username:user.username,
      email:user.email
    }
  })
}

async function login(req,res) {
  const {email,password}=req.body;

  const user=await userModel.findOne({
    $or:[
      {email},
      {password}
    ]
  });

  if(!user) {
    return res.status(401).json({
      message:"Invalid credentials"
    });
  }

  const isPasswordValid=await bcrypt.compare(password,user.password);

  if(!isPasswordValid) {
    return res.status(401).json({
      message:"Invalid credentials"
    });
  }

  const token=jwt.sign({
    id:user._id,
    username:user.username
  },process.env.JWT,{expiresIn:"1d"});

  res.cookie("token",token);

  res.status(200).json({
    message:"Logged in successfully",
    user:{
      username:user.username,
      email:user.email
    }
  });
}

const logout=async (req,res)=> {

  const token=req.cookies.token;

  const user=await blackListModel.create({
    token
  })

 res.clearCookie("token");

  return res.status(200).json({
    message:"Logout SuccessFully!",
  })
}


const getme=async (req,res)=> {
  const {id,username}=req.user;

  const user=await userModel.findById(id);

  if(!user) { 
    return res.status(404).json({
      message:"User not found!"
    })
  }

  res.status(200).json({
    message:"User found!",
    user: {
      id:user._id,
      username:user.username,
      email:user.email
    }
  })
  // thats all
}

module.exports={register,login,logout,getme}