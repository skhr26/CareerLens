const mongoose=require('mongoose');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to Database")
  } catch(err) {
    console.log("Error message",err);
  }
}


module.exports=connectDB
