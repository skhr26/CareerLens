const express=require("express");

const app=express();
const cookieParser=require("cookie-parser");

const connectDB=require('./db/db')

connectDB();

// all the middle ware and all the routes will be defined here

app.use(express.json());
app.use(cookieParser());

const authRouter=require('./routes/authRoutes');


// basiaclly ye api ko ham define kar rhe har api ke x kaam honge like jaise iss vale ke register and login ka 

app.use("/api/auth",authRouter);



module.exports=app