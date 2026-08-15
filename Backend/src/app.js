const express = require("express")
const cookieParser = require("cookie-parser")
const cors = require("cors")
const {resume,jobDescription,selfDescription}=require("./services/temp")

const app = express()

app.use(express.json())
app.use(cookieParser())
app.use(cors({
    origin: "http://localhost:5173",
    credentials: true
}))


const connectDB=require('./db/db')
// invokeGeminiAI();
connectDB();




// const generateInterviewReport=require('../src/services/ai.service');
// generateInterviewReport({resume,selfDescription,jobDescription});
// app.use(cors({
//   origin:"http://localhost:5173",
//   credentials: true
// }))

// previously we were using the text sample but now since we want the user to upload his.her resume we will make its endpoint i.e. api

const authRouter=require('./routes/authRoutes');
const interViewRouter=require('./routes/reportRoutes')


// basically ye api ko ham define kar rhe har api ke x kaam honge like jaise iss vale ke register and login ka 

app.use("/api/auth",authRouter);

app.use('/api/report',interViewRouter)

module.exports=app