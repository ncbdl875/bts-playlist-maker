const clientId = '44fce08e32a04c6abf3380a3ca4c8fa2';
const clientSecret = '53d65c8cb547400aa8aebf808cd677fa';
const code = 'AQA_sIOgWxlXkMuG_cFZTWTTZRjU8XFNoI6-SMaGC1o9TCHJAK7PSFrqjfpwnHSeWm8dUa-AW7a6ieqRh-fe-4uiDbREWeZfnzym9lnUZwDYRTaRKx8j1vmrM1vXBpcFeciBaZSMj9JVRo_XX685NjYZNdAcxAbOXD6dRD4dWi6y_hIdRQ86mO4yhyvz7-FXjM11lnUv0-ZBEvm_lAYbpyqu0aw48-E4DFfxkcKmjCbmdMRCDDdgsxjUTbjWNrShdthg8B4FCwmXaBIVlUaLgEM';
const redirectUri = 'http://127.0.0.1:3000'; // Hoặc http://localhost:3000 tùy Redirect URI bạn dùng

const getToken = async () => {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri
    })
  });

  const data = await response.json();
  console.log("Kết quả từ Spotify:", data);
};

getToken();