const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

// ==================== CONFIG ====================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rayhnludfxhzeaacjfco.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const BOT_TOKEN = process.env.BOT_TOKEN || '';

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Установка current_user_id для RLS
async function setUserContext(userId) {
  if (userId) {
    await supabase.rpc('set_config', { key: 'app.current_user_id', value: userId });
  }
}

// ==================== HELPERS ====================
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getDayIndex(date) {
  return date.getDay();
}

async function sendMessage(chatId, text, options) {
  options = options || {};
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        ...options
      })
    });
    return await res.json();
  } catch (e) {
    console.error('Send message error:', e);
    return null;
  }
}

// ==================== COMMANDS ====================
async function handleStart(chatId) {
  const text = `🦝 <b>Енотов Ежедневник</b>\n\nПривет! Я бот-помощник для твоего ежедневника.\n\n<b>Команды:</b>\n/tasks — твои активные задачи на сегодня\n/tasks all — все задачи на сегодня\n/tasks week — задачи на неделю\n/week — обзор недели\n/journal — статус дневника\n/progress — прогресс недели\n/stats — статистика\n/settings — настройки\n/myid — узнать свой Chat ID\n/help — справка\n\nНапиши мне любое сообщение — я пойму что тебе нужно!`;
  await sendMessage(chatId, text);
}

async function handleMyId(chatId) {
  await sendMessage(chatId, `🆔 <b>Ваш Chat ID</b>\n\n<code>${chatId}</code>\n\nСкопируй эти цифры и вставь в приложении Енотов Ежедневник → 🔗 Привязать Telegram.`);
}

async function handleTasks(chatId, userId, filter) {
  filter = filter || 'today';
  const now = new Date();
  const week = getWeekNumber(now);
  const day = getDayIndex(now);
  const year = now.getFullYear();

  let query = supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('week', week)
    .eq('year', year);

  if (filter === 'today') {
    query = query.eq('done', false).contains('days', [day]);
  } else if (filter === 'all') {
    query = query.contains('days', [day]);
  } else if (filter === 'week') {
    query = query.eq('done', false);
  }

  const { data: tasks, error } = await query;

  if (error) {
    await sendMessage(chatId, '❌ Ошибка при получении задач');
    return;
  }

  if (!tasks || tasks.length === 0) {
    await sendMessage(chatId, '✅ На сегодня нет активных задач! Отличная работа!');
    return;
  }

  const daysNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const cats = { work: '💼 Работа', habit: '🌱 Привычка', hobby: '🎨 Хобби', other: '📌 Разное' };

  let text = filter === 'week'
    ? `📋 <b>Активные задачи на неделю</b>\n\n`
    : `📋 <b>Задачи на сегодня (${daysNames[day]})</b>\n\n`;

  tasks.forEach(function(t, i) {
    const cat = cats[t.category] || '📌';
    const daysStr = t.days ? t.days.map(function(d) { return daysNames[d]; }).join(', ') : '';
    text += (i + 1) + '. ' + cat + ' ' + t.text + '\n';
    if (filter === 'week') text += '   📅 ' + daysStr + '\n';
    text += '\n';
  });

  text += '\n💡 Открой приложение, чтобы отметить выполненные.';
  await sendMessage(chatId, text);
}

async function handleWeek(chatId, userId) {
  const now = new Date();
  const week = getWeekNumber(now);
  const year = now.getFullYear();
  const day = getDayIndex(now);

  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('week', week)
    .eq('year', year);

  const { data: journal } = await supabase
    .from('journal')
    .select('*')
    .eq('user_id', userId)
    .eq('week', week)
    .eq('year', year);

  const daysNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  let text = `📊 <b>Обзор недели</b>\n\n`;

  for (let d = 0; d < 7; d++) {
    const dayTasks = tasks ? tasks.filter(function(t) { return t.days && t.days.includes(d); }) : [];
    const doneTasks = dayTasks.filter(function(t) { return t.done; });
    const dayJournal = journal ? journal.find(function(j) { return j.day === d; }) : null;
    const progress = dayTasks.length > 0 ? Math.round((doneTasks.length / dayTasks.length) * 100) : 0;
    const bar = '█'.repeat(Math.round(progress / 10)) + '░'.repeat(10 - Math.round(progress / 10));
    const isToday = d === day ? ' 👈' : '';

    text += daysNames[d] + ': ' + bar + ' ' + progress + '%' + isToday + '\n';
    if (dayJournal) {
      text += '   😴 ' + dayJournal.sleep + 'ч ⚡' + dayJournal.energy + ' 😊' + dayJournal.mood + '\n';
    }
  }

  const totalTasks = tasks ? tasks.length : 0;
  const totalDone = tasks ? tasks.filter(function(t) { return t.done; }).length : 0;
  const totalProgress = totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0;
  text += `\n📈 <b>Итого:</b> ${totalDone}/${totalTasks} (${totalProgress}%)`;

  await sendMessage(chatId, text);
}

async function handleJournal(chatId, userId) {
  const now = new Date();
  const week = getWeekNumber(now);
  const day = getDayIndex(now);
  const year = now.getFullYear();

  const { data: journal } = await supabase
    .from('journal')
    .select('*')
    .eq('user_id', userId)
    .eq('week', week)
    .eq('year', year)
    .eq('day', day)
    .single();

  if (!journal) {
    await sendMessage(chatId, `📝 <b>Дневник сегодня</b>\n\nДневник ещё не заполнен.\n\nОткрой приложение и заполни: сон, энергию, настроение, урок дня и благодарность.`);
    return;
  }

  const text = `📝 <b>Дневник на сегодня</b>\n\n` +
    `😴 Сон: ${journal.sleep}ч\n` +
    `⚡ Энергия: ${journal.energy}/5\n` +
    `😊 Настроение: ${journal.mood}/5\n` +
    `💡 Урок дня: ${journal.lesson || '—'}\n` +
    `🙏 Благодарность: ${journal.gratitude || '—'}\n` +
    `📝 Заметки: ${journal.notes || '—'}`;

  await sendMessage(chatId, text);
}

async function handleProgress(chatId, userId) {
  const now = new Date();
  const week = getWeekNumber(now);
  const year = now.getFullYear();

  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('week', week)
    .eq('year', year);

  const total = tasks ? tasks.length : 0;
  const done = tasks ? tasks.filter(function(t) { return t.done; }).length : 0;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  const bar = '█'.repeat(Math.round(progress / 10)) + '░'.repeat(10 - Math.round(progress / 10));

  const text = `📊 <b>Прогресс недели</b>\n\n` +
    bar + '\n' +
    done + '/' + total + ' задач выполнено (' + progress + '%)\n\n' +
    (progress >= 80 ? '🎉 Отличный результат!' : progress >= 50 ? '💪 Хороший темп, продолжай!' : '🚀 Есть куда стремиться!');

  await sendMessage(chatId, text);
}

async function handleStats(chatId, userId) {
  const now = new Date();
  const week = getWeekNumber(now);
  const year = now.getFullYear();

  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('week', week)
    .eq('year', year);

  const { data: journal } = await supabase
    .from('journal')
    .select('*')
    .eq('user_id', userId)
    .eq('week', week)
    .eq('year', year);

  const total = tasks ? tasks.length : 0;
  const done = tasks ? tasks.filter(function(t) { return t.done; }).length : 0;
  const avgSleep = journal && journal.length > 0
    ? (journal.reduce(function(s, j) { return s + (j.sleep || 0); }, 0) / journal.length).toFixed(1)
    : 0;
  const avgEnergy = journal && journal.length > 0
    ? (journal.reduce(function(s, j) { return s + (j.energy || 0); }, 0) / journal.length).toFixed(1)
    : 0;
  const avgMood = journal && journal.length > 0
    ? (journal.reduce(function(s, j) { return s + (j.mood || 0); }, 0) / journal.length).toFixed(1)
    : 0;

  const text = `📈 <b>Статистика недели</b>\n\n` +
    `✅ Выполнено: ${done}/${total}\n` +
    `😴 Средний сон: ${avgSleep}ч\n` +
    `⚡ Средняя энергия: ${avgEnergy}/5\n` +
    `😊 Среднее настроение: ${avgMood}/5\n` +
    `📝 Дней с дневником: ${journal ? journal.length : 0}/7`;

  await sendMessage(chatId, text);
}

async function handleHelp(chatId) {
  const text = `🦝 <b>Енотов Ежедневник — Справка</b>\n\n` +
    `<b>Команды:</b>\n` +
    `/tasks — активные задачи на сегодня\n` +
    `/tasks all — все задачи на сегодня\n` +
    `/tasks week — активные задачи на неделю\n` +
    `/week — обзор недели с прогрессом\n` +
    `/journal — статус дневника сегодня\n` +
    `/progress — прогресс недели (%)\n` +
    `/stats — полная статистика\n` +
    `/settings — настройки уведомлений\n` +
    `/myid — узнать свой Chat ID\n` +
    `/help — эта справка\n\n` +
    `<b>Свободные сообщения:</b>\n` +
    `«задачи», «дела», «что сегодня» → список задач\n` +
    `«дневник» → статус дневника\n` +
    `«прогресс», «статистика» → прогресс недели\n\n` +
    `💡 Данные берутся из твоего приложения. Привяжи Telegram в настройках PWA.`;
  await sendMessage(chatId, text);
}

async function handleSettings(chatId, userId) {
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  const morning = user && user.notify_morning ? user.notify_morning : '08:00';
  const evening = user && user.notify_evening ? user.notify_evening : '21:00';

  const text = `⚙️ <b>Настройки уведомлений</b>\n\n` +
    `🌅 Утреннее: ${morning}\n` +
    `🌙 Вечернее: ${evening}\n\n` +
    `Изменить можно в приложении: Настройки → Уведомления`;
  await sendMessage(chatId, text);
}

// ==================== WEBHOOK HANDLER ====================
app.post('/webhook', async function(req, res) {
  const update = req.body;

  if (!update.message && !update.callback_query) {
    return res.sendStatus(200);
  }

  const msg = update.message || (update.callback_query && update.callback_query.message);
  const chatId = msg.chat.id;
  const text = update.message ? update.message.text : '';

  // Найти пользователя по chat_id (RLS позволяет чтение по telegram_chat_id)
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('telegram_chat_id', chatId)
    .single();

  const userId = user ? user.id : null;

  // Если нет user_id — предложить привязку
  if (!userId && text !== '/start' && text !== '/myid' && text !== '/help') {
    await sendMessage(chatId, `⚠️ Ты ещё не привязал Telegram к приложению.\n\n` +
      `1. Открой Енотов Ежедневник\n` +
      `2. Нажми 🔗 Привязать Telegram\n` +
      `3. Введи свой Chat ID: <code>${chatId}</code>`, { parse_mode: 'HTML' });
    return res.sendStatus(200);
  }

  // Команды
  if (text === '/start') {
    await handleStart(chatId);
  } else if (text === '/myid') {
    await handleMyId(chatId);
  } else if (text === '/tasks' || text === '/tasks today') {
    await handleTasks(chatId, userId, 'today');
  } else if (text === '/tasks all') {
    await handleTasks(chatId, userId, 'all');
  } else if (text === '/tasks week') {
    await handleTasks(chatId, userId, 'week');
  } else if (text === '/week') {
    await handleWeek(chatId, userId);
  } else if (text === '/journal') {
    await handleJournal(chatId, userId);
  } else if (text === '/progress') {
    await handleProgress(chatId, userId);
  } else if (text === '/stats') {
    await handleStats(chatId, userId);
  } else if (text === '/settings') {
    await handleSettings(chatId, userId);
  } else if (text === '/help') {
    await handleHelp(chatId);
  } else {
    // Свободные сообщения
    const lower = text.toLowerCase();
    if (lower.includes('задач') || lower.includes('дел') || lower.includes('сегодня') || lower.includes('план')) {
      await handleTasks(chatId, userId, 'today');
    } else if (lower.includes('дневник') || lower.includes('сон') || lower.includes('настроение')) {
      await handleJournal(chatId, userId);
    } else if (lower.includes('прогресс') || lower.includes('статист') || lower.includes('%')) {
      await handleProgress(chatId, userId);
    } else if (lower.includes('недел')) {
      await handleWeek(chatId, userId);
    } else if (lower.includes('айди') || lower.includes('id') || lower.includes('идентификатор')) {
      await handleMyId(chatId);
    } else {
      await sendMessage(chatId, `🦝 Я понимаю команды и ключевые слова.\n\nНапиши /help для списка команд.`);
    }
  }

  res.sendStatus(200);
});

// ==================== API ENDPOINTS FOR PWA ====================

// Синхронизация данных из PWA
app.post('/api/sync', async function(req, res) {
  const { user_id, tasks, journal } = req.body;

  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  try {
    if (tasks && tasks.length > 0) {
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        await supabase.from('tasks').upsert({
          id: task.id,
          user_id: task.user_id || user_id,
          text: task.text,
          category: task.category,
          type: task.type,
          days: task.days,
          week: task.week,
          year: task.year,
          done: task.done,
          created_at: task.created_at || new Date().toISOString()
        });
      }
    }

    if (journal) {
      if (Array.isArray(journal)) {
        for (let i = 0; i < journal.length; i++) {
          const j = journal[i];
          await supabase.from('journal').upsert({
            id: j.id || (user_id + '-' + j.week + '-' + j.day),
            user_id: j.user_id || user_id,
            week: j.week,
            day: j.day,
            year: j.year,
            sleep: j.sleep,
            energy: j.energy,
            mood: j.mood,
            lesson: j.lesson,
            gratitude: j.gratitude,
            notes: j.notes,
            created_at: j.created_at || new Date().toISOString()
          });
        }
      } else {
        await supabase.from('journal').upsert({
          id: journal.id || (user_id + '-' + journal.week + '-' + journal.day),
          user_id: journal.user_id || user_id,
          week: journal.week,
          day: journal.day,
          year: journal.year,
          sleep: journal.sleep,
          energy: journal.energy,
          mood: journal.mood,
          lesson: journal.lesson,
          gratitude: journal.gratitude,
          notes: journal.notes,
          created_at: journal.created_at || new Date().toISOString()
        });
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error('Sync error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Получить задачи
app.get('/api/tasks', async function(req, res) {
  const { user_id, week, year, day, done } = req.query;

  let query = supabase.from('tasks').select('*').eq('user_id', user_id);
  if (week) query = query.eq('week', week);
  if (year) query = query.eq('year', year);
  if (day !== undefined) query = query.contains('days', [parseInt(day)]);
  if (done !== undefined) query = query.eq('done', done === 'true');

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error });
  res.json(data || []);
});

// Получить дневник
app.get('/api/journal', async function(req, res) {
  const { user_id, week, year, day } = req.query;

  let query = supabase.from('journal').select('*').eq('user_id', user_id);
  if (week) query = query.eq('week', week);
  if (year) query = query.eq('year', year);
  if (day !== undefined) query = query.eq('day', day);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error });
  res.json(data || []);
});

// Привязка Telegram
app.post('/api/link-telegram', async function(req, res) {
  const { user_id, chat_id } = req.body;

  if (!user_id || !chat_id) return res.status(400).json({ error: 'user_id and chat_id required' });

  await setUserContext(user_id);

  const { error } = await supabase
    .from('users')
    .upsert({ id: user_id, telegram_chat_id: chat_id }, { onConflict: 'id' });

  if (error) {
    console.error('Link error:', error);
    return res.status(500).json({ error: error });
  }

  await sendMessage(chat_id, `✅ <b>Енотов Ежедневник подключён!</b>\n\nТеперь я буду присылать:\n🌅 Утренние задачи\n🌙 Напоминания о дневнике\n\nНапиши /help для команд.`);
  res.json({ success: true });
});

// ==================== CRON NOTIFICATIONS ====================

// Утреннее напоминание (8:00 по умолчанию)
async function sendMorningNotifications() {
  const now = new Date();
  const week = getWeekNumber(now);
  const day = getDayIndex(now);
  const year = now.getFullYear();

  const { data: users } = await supabase
    .from('users')
    .select('id, telegram_chat_id, notify_morning')
    .not('telegram_chat_id', 'is', null);

  for (let i = 0; i < (users || []).length; i++) {
    const user = users[i];
    const morningTime = user.notify_morning || '08:00';
    const currentTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    if (currentTime !== morningTime) continue;

    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', user.id)
      .eq('week', week)
      .eq('year', year)
      .eq('done', false)
      .contains('days', [day]);

    const count = tasks ? tasks.length : 0;
    let text = `🌅 <b>Доброе утро!</b>\n\n` +
      `Сегодня ${count} активных задач.\n\n`;
    if (count > 0) {
      text += tasks.map(function(t, i) { return (i + 1) + '. ' + t.text; }).join('\n');
    } else {
      text += 'Отличный день для отдыха! ☕';
    }
    text += `\n\n💡 Открой приложение и начни день продуктивно!`;

    await sendMessage(user.telegram_chat_id, text);
  }
}

// Вечернее напоминание (21:00 по умолчанию)
async function sendEveningNotifications() {
  const now = new Date();
  const week = getWeekNumber(now);
  const day = getDayIndex(now);
  const year = now.getFullYear();

  const { data: users } = await supabase
    .from('users')
    .select('id, telegram_chat_id, notify_evening')
    .not('telegram_chat_id', 'is', null);

  for (let i = 0; i < (users || []).length; i++) {
    const user = users[i];
    const eveningTime = user.notify_evening || '21:00';
    const currentTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    if (currentTime !== eveningTime) continue;

    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', user.id)
      .eq('week', week)
      .eq('year', year)
      .eq('done', false)
      .contains('days', [day]);

    const { data: journal } = await supabase
      .from('journal')
      .select('*')
      .eq('user_id', user.id)
      .eq('week', week)
      .eq('year', year)
      .eq('day', day)
      .single();

    let text = `🌙 <b>Вечернее напоминание</b>\n\n`;

    if (tasks && tasks.length > 0) {
      text += `❗ Осталось ${tasks.length} невыполненных задач\n\n`;
    }

    if (!journal) {
      text += `📝 Дневник ещё не заполнен.\n`;
    } else {
      text += `✅ Дневник заполнен. Молодец!\n`;
    }

    text += `\n💡 Открой приложение, чтобы завершить день.`;
    await sendMessage(user.telegram_chat_id, text);
  }
}

// Проверка дневника в 22:00
async function checkJournalAt22() {
  const now = new Date();
  const week = getWeekNumber(now);
  const day = getDayIndex(now);
  const year = now.getFullYear();

  const { data: users } = await supabase
    .from('users')
    .select('id, telegram_chat_id')
    .not('telegram_chat_id', 'is', null);

  for (let i = 0; i < (users || []).length; i++) {
    const user = users[i];
    const { data: journal } = await supabase
      .from('journal')
      .select('*')
      .eq('user_id', user.id)
      .eq('week', week)
      .eq('year', year)
      .eq('day', day)
      .single();

    if (!journal) {
      await sendMessage(user.telegram_chat_id,
        `⏰ <b>Напоминание</b>\n\nДневник всё ещё не заполнен.\n\n` +
        `📝 Сон, энергия, настроение — всего пара минут.\n` +
        `Открой приложение и запиши свой день!`);
    }
  }
}

// Cron jobs (каждую минуту проверяем время)
cron.schedule('* * * * *', async function() {
  await sendMorningNotifications();
  await sendEveningNotifications();
});

cron.schedule('0 22 * * *', async function() {
  await checkJournalAt22();
});

// ==================== HEALTH CHECK ====================
app.get('/', function(req, res) {
  res.json({ status: 'ok', bot: 'Enotov Ezhednevnik', time: new Date().toISOString() });
});

// ==================== START ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log(`🦝 Enotov Bot running on port ${PORT}`);
  console.log(`Webhook URL: /webhook`);
});
