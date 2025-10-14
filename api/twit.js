import dotenv from "dotenv";
dotenv.config();
import { TwitterApi } from "twitter-api-v2";

const client = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

async function testTwitter() {
  try {
    const me = await client.v2.me();

    console.log("✅ Connected as:", me.data.username);
    await client.v2.tweet({
      text: "Testing link https://www.trendzlib.com.ng"
    });

  } catch (err) {
    console.error("❌ Twitter Auth Failed:", err.message);
  }
}

testTwitter();
