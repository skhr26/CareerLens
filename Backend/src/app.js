const express=require("express");

const app=express();

const connectDB=require('./db/db')

connectDB();

app.use(express.json());

const authRouter=require('./routes/authRoutes');


// basiaclly ye api ko ham define kar rhe har api ke x kaam honge like jaise iss vale ke register and login ka 

app.use("/api/auth",authRouter);



module.exports=app