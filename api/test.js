import handler from './update-news.js';

// Mock request/response for local testing
const mockReq = { method: 'GET' };
const mockRes = {
  status: (code) => ({
    json: (data) => {
      console.log('\n📊 RESPONSE:', JSON.stringify(data, null, 2));
      process.exit(code === 200 ? 0 : 1);
    }
  })
};

handler(mockReq, mockRes);