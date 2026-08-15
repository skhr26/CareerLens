const jwt=require("jsonwebtoken");
const blackListModel=require("../models/blacklist")

async function authMiddleware(req,res,next) {
  const token=req.cookies.token;
  if(!token) {
    return res.status(401).json({
      message:"Unauthorized"
    });
  }

  // now you have to check ki kahi vo token blacklist me to nahi hai
  const exist=await blackListModel.findOne({token});

  if(exist) {
    return res.status(401).json({
      message:"Token is blacklisted"
    });
  }

  try {
    const decoded=jwt.verify(token,process.env.JWT);
    // id and username milega
    req.user=decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      message:"Invalid token"
    });
  }
}


module.exports={authMiddleware}