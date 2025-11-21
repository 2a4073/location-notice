const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
require('dotenv').config();

const DISCORD_WEBHOOK_URL_LOCATION = process.env.DISCORD_WEBHOOK_URL_LOCATION;
const DISCORD_WEBHOOK_URL_LINE_USER = process.env.DISCORD_WEBHOOK_URL_LINE_USER;

// LINE Botの設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

// LINE SDKクライアントの初期化
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken
});

// Expressアプリの初期化
const app = express();

// Webhookエンドポイント
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

app.use(express.json());

app.post('/location', async (req, res) => {
    const data = req.body;
    const specialUserIds = [
        process.env.LINE_SPECIAL_USER_ID_1,
        process.env.LINE_SPECIAL_USER_ID_2
    ];

    try {
        // console.log(data);
        const currAdress = await fetchAdress(data.lat, data.lon);

        const webhookMessage = `**緯度**: ${data.lat}\n**経度**: ${data.lon}\n**住所**: ${currAdress}`;
        if (data._type === "location") {
            pushWebhook("位置情報更新通知", "位置情報が更新されました。", webhookMessage, DISCORD_WEBHOOK_URL_LOCATION);
            console.log(currAdress);
        }

        if (data._type === "transition") {
            const geofenceWebhook = `イベント: **${data.event}**\nエリア名: **${data.desc}**\n${webhookMessage}`;
            if (data.event === "enter") {
                console.log(`ジオフェンシング：\n\t状態: エリア内\n\tエリア: ${data.desc}\n\t現在地: ${currAdress}`);
                pushWebhook("進入通知", "指定のエリアに進入しました。", geofenceWebhook, DISCORD_WEBHOOK_URL_LOCATION, "15128606");

                noticeEnter(specialUserIds, data.desc, currAdress);

            } else if (data.event === "leave") {
                console.log(`ジオフェンシング：\n\t状態: エリア外\n\tエリア: ${data.desc}\n\t現在地: ${currAdress}`);
                pushWebhook("退出通知", "指定のエリアから退出しました。", geofenceWebhook, DISCORD_WEBHOOK_URL_LOCATION, "15128606");
            }
        }
    } catch (e) {
        console.error(e.message);
    }

    res.json([]);
});

app.get('/', (req, res) => {
    res.json({ message: 'who are you?' });
});

// イベントハンドラー
async function handleEvent(event) {
    // メッセージイベント以外は無視
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    const displayName = await client.getProfile(event.source.userId);
    const pushMessage = `**ユーザー:** ${event.source.userId}\n**表示名:** ${displayName.displayName}`;
    pushWebhook("ユーザーID", "LINEユーザーのIDを通知します。", pushMessage, DISCORD_WEBHOOK_URL_LINE_USER, "15128606");

    // 返信メッセージを作成
    const echo = { 
        type: 'text', 
        text: `開発：北野\n2025年11月 開始` 
    };
    // 返信を送信
    return client.replyMessage({
        replyToken: event.replyToken,
        messages: [echo]
    });
}

// サーバー起動
const port = 3001;
app.listen(port, () => {
    console.log(`LINE Bot listening on port ${port}`);
});

function lineBroadcastMessage(message) {
    if (!message) {
        return;
    }

    // console.log(message);

    client.broadcast({
        messages: [
            {
                type: 'text',
                text: message
            }
        ],
        notificationDisabled: false
    });
}

function linePushMessage(userIds, message) {
    if (!message || !userIds) {
        return;
    }

    // console.log(userId, message);

    client.pushMessage({
        to: userIds,
        messages: [
            {
                type: 'text',
                text: message
            }
        ],
    });
}

function noticeEnter(userIds, area, addr) {
    if (!userId || !area || !addr) {
        return;
    }

    const now = new Date();
    const hour = now.getHours();
    const isGoHomeTimeZone = (hour >= 13 && hour < 21);
    const isWeekday = (now.getDay() >= 1 && now.getDay() <= 5);
    
    if (isGoHomeTimeZone && isWeekday) {

        let nowArea = "";
        switch (area) {
            case "home":
                nowArea = "もうすぐ家着きます";
                break;
            case "sogawa":
                nowArea = "今総曲輪あたりにいます";
                break;
            default:
                console.log("undefined area");
                return;
        }
        const message = `${nowArea}\n現在地: ${addr}`;

        linePushMessage(userIds, message);
    }
}

// 住所取得
async function fetchAdress(lat, lon) {
    try {
        const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`; 
        const response = await axios.get(url);
        const result = response.data.results;

        return result.lv01Nm || 'unkonow';
    } catch (error) {
        console.error('住所取得エラー', error.message);
        return 'failed';
    }
}

//Webhookを送信
async function pushWebhook(title, desc, message, url, color) {
    if (!url || !message) {
        return;
    }

    const embedColor = color || "3319890";

    try {
        const payload = {
            'embeds': [
                {
                    'title': title,
                    'description': desc,
                    'color': embedColor,
                    'fields': [
                        {
                            'name': '',
                            'value': message,
                            'inline': false
                        }
                    ],
                    'timestamp': new Date().toISOString(),
                    'footer': {
                        'text': '帰宅通知'
                    }
                }
            ]
        };

        await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
            },
        });

        console.log('webhook送信');
    } catch (error) {
        console.error('Webhook送信エラー', error.message);
    }
}

module.exports =  {
    linePushMessage: linePushMessage
};
