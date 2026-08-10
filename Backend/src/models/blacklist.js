// although you do these things using the redis but now since we havent learned it we are gonaa keep things simple 
const mongoose=require("mongoose");



const blackListTokenSchema=new mongoose.Schema({
  token: {
    type:String,
    required:[true,"token is required to be added in blacklist "]
  }
}, {
  timestamps:true
})

module.exports=mongoose.model("blackList",blackListTokenSchema)