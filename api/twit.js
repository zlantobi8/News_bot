import dotenv from "dotenv";
import { TwitterApi } from "twitter-api-v2";
dotenv.config();

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

async function checkTwitterPermissions() {
  console.log("\n🔍 TWITTER API DIAGNOSTICS");
  console.log("=".repeat(70));
  
  try {
    // 1. Check if we can authenticate
    console.log("\n1️⃣ Testing Authentication...");
    const me = await twitterClient.v2.me();
    console.log(`   ✅ Authenticated as: @${me.data.username}`);
    console.log(`   User ID: ${me.data.id}`);
    console.log(`   Account name: ${me.data.name}`);
    
    // 2. Check app and user context
    console.log("\n2️⃣ Checking App Context...");
    try {
      const appInfo = await twitterClient.v2.get('users/me');
      console.log(`   ✅ User context verified`);
    } catch (error) {
      console.error(`   ❌ User context error: ${error.message}`);
    }
    
    // 3. Test read permissions
    console.log("\n3️⃣ Testing Read Permissions...");
    try {
      const tweets = await twitterClient.v2.userTimeline(me.data.id, { max_results: 5 });
      console.log(`   ✅ Can read tweets (${tweets.data.data?.length || 0} tweets fetched)`);
    } catch (error) {
      console.error(`   ❌ Cannot read tweets: ${error.message}`);
    }
    
    // 4. Test write permissions (the critical one)
    console.log("\n4️⃣ Testing Write Permissions...");
    console.log(`   ⚠️ Attempting to post a test tweet...`);
    
    try {
      // Try to post a simple test tweet
      const testTweet = await twitterClient.v2.tweet({
        text: `🤖 API Test - ${new Date().toISOString()}`
      });
      
      console.log(`   ✅ SUCCESS! Can post tweets`);
      console.log(`   Tweet ID: ${testTweet.data.id}`);
      console.log(`   URL: https://twitter.com/i/web/status/${testTweet.data.id}`);
      
      // Optionally delete the test tweet
      console.log(`\n   🗑️ Do you want to delete this test tweet? (You can delete it manually)`);
      
    } catch (error) {
      console.error(`   ❌ CANNOT POST TWEETS!`);
      console.error(`   Error: ${error.message}`);
      
      if (error.code === 403) {
        console.log(`\n   🔴 403 FORBIDDEN ERROR DETECTED`);
        console.log(`   This means your app doesn't have write permissions.`);
        console.log(`\n   📋 TO FIX THIS:`);
        console.log(`   1. Go to: https://developer.twitter.com/en/portal/dashboard`);
        console.log(`   2. Select your app`);
        console.log(`   3. Go to "Settings" → "User authentication settings"`);
        console.log(`   4. Set "App permissions" to "Read and Write"`);
        console.log(`   5. IMPORTANT: Go to "Keys and tokens" tab`);
        console.log(`   6. Click "Regenerate" for Access Token & Secret`);
        console.log(`   7. Update your .env file with NEW tokens`);
        console.log(`   8. Restart your application`);
      } else if (error.code === 429) {
        console.log(`\n   ⚠️ RATE LIMIT ERROR`);
        console.log(`   You've exceeded your API rate limits`);
      } else if (error.code === 401) {
        console.log(`\n   🔴 AUTHENTICATION ERROR`);
        console.log(`   Your API credentials are invalid or expired`);
        console.log(`   Please regenerate your tokens`);
      }
      
      if (error.data) {
        console.log(`\n   📄 Full Error Details:`, JSON.stringify(error.data, null, 2));
      }
    }
    
    // 5. Check API tier/plan
    console.log("\n5️⃣ API Access Level:");
    console.log(`   ℹ️ Based on the results above:`);
    
    if (me.data) {
      console.log(`   - You have authenticated successfully ✅`);
      console.log(`   - Check the write permissions test above`);
      console.log(`\n   📊 Twitter API Tiers:`);
      console.log(`   • Free: Read-only, 500 tweets/month`);
      console.log(`   • Basic ($100/mo): Read+Write, 3,000 tweets/month`);
      console.log(`   • Pro ($5,000/mo): Full access`);
    }
    
    console.log("\n=".repeat(70));
    console.log("✅ Diagnostics Complete\n");
    
  } catch (error) {
    console.error("\n❌ CRITICAL ERROR:");
    console.error(`   ${error.message}`);
    
    if (error.code === 401) {
      console.log(`\n   🔴 INVALID CREDENTIALS`);
      console.log(`   Your API keys are incorrect or expired`);
      console.log(`\n   Please check your .env file:`);
      console.log(`   - TWITTER_APP_KEY`);
      console.log(`   - TWITTER_APP_SECRET`);
      console.log(`   - TWITTER_ACCESS_TOKEN`);
      console.log(`   - TWITTER_ACCESS_SECRET`);
    }
    
    console.log("\n=".repeat(70));
  }
}

// Alternative: Test with a simpler method
async function quickPermissionCheck() {
  console.log("\n🚀 QUICK PERMISSION CHECK\n");
  
  try {
    const client = twitterClient.readWrite;
    const me = await client.v2.me();
    console.log(`✅ Connected as @${me.data.username}`);
    
    // Try to get app rate limits (shows what you can do)
    const rateLimits = await client.v2.get('application/rate_limit_status.json');
    console.log(`\n📊 Some available endpoints:`);
    
    // Check specific endpoints
    const tweetLimits = rateLimits?.resources?.tweets;
    if (tweetLimits) {
      console.log(`   Tweets endpoint available: ✅`);
    } else {
      console.log(`   Tweets endpoint: ⚠️ Limited or unavailable`);
    }
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
}

// Run diagnostics
console.log("Choose test:");
console.log("1. Full diagnostics (includes test tweet attempt)");
console.log("2. Quick check (no posting attempt)\n");

// Run full diagnostics by default


// Uncomment for quick check instead:
// quickPermissionCheck();