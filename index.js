const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

// ===== CONFIG =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== TELEGRAM API =====
async function tgRequest(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return await res.json();
}

async function sendMessage(chatId, text, extra = {}) {
  return tgRequest('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...extra
  });
}

// ===== WEBHOOK =====
app.post('/webhook', async (req, res) => {
  const update = req.body;
  res.sendStatus(200);

  // Команды
  if (update.message?.text) {
    const text = update.message.text;
    const chatId = update.message.chat.id;
    const firstName = update.message.from.first_name;

    if (text === '/start') {
      await handleStart(chatId, firstName);
    }
    else if (text === '/tasks') {
      await handleTasks(chatId, 'today');
    }
    else if (text === '/tasks all') {
      await handleTasks(chatId, 'all');
    }
    else if (text === '/tasks week') {
      await handleTasks(chatId, 'week');
    }
    else if (text === '/week') {
      await handleWeek(chatId);
    }
    else if (text === '/journal') {
      await handleJournal(chatId);
    }
    else if (text === '/progress') {
      await handleProgress(chatId);
    }
    else if (text === '/stats') {
      await handleStats(chatId);
    }
    else if (text === '/settings') {
      await handleSettings(chatId);
    }
    else if (text === '/myid') {
      await sendMessage(chatId, `🆔 <b>Ваш ID:</b>\n\n<code>${chatId}</code>\n\nНажми на цифры — они скопируются.`);
    }
    else if (text === '/help') {
      await handleHelp(chatId);
    }
    else if (text.startsWith('/setmorning')) {
      const time = text.split(' ')[1];
      await setNotifyTime(chatId, 'morning', time);
    }
    else if (text.startsWith('/setevening')) {
      const time = text.split(' ')[1];
      await setNotifyTime(chatId, 'evening', time);
    }
    else {
      // Свободные сообщения
      await handleFreeText(chatId, text);
    }
  }
});

// ===== HANDLERS =====

async function handleStart(chatId, firstName) {
  // Создаём пользователя если нет
  await supabase.from('users').upsert({
    telegram_id: chatId,
    first_name: firstName
  }, { onConflict: 'telegram_id' });

  await sendMessage(chatId,
    `🦝 <b>Привет, ${firstName}!</b>\n\n` +
    `Я — Енотов Ежедневник. Помогаю планировать день и отслеживать привычки.\n\n` +
    `📱 <b>Открой ежедневник:</b> нажми кнопку «Ежедневник» внизу\n\n` +
    `Или используй команды:\n` +
    `/tasks — задачи на сегодня\n` +
    `/week — обзор недели\n` +
    `/journal — дневник\n` +
    `/help — все команды`,
    {
      reply_markup: {
        inline_keyboard: [[{
          text: '📓 Открыть Ежедневник',
          web_app: { url: 'https://enottail.github.io/Raccoon-s-Diary' }
        }]]
      }
    }
  );
}

async function handleTasks(chatId, filter) {
  const now = new Date();
  const week = getWeekNumber(now);
  const year = now.getFullYear();
  const day = now.getDay();

  let query = supabase
    .from('tasks')
    .select('*')
    .eq('telegram_id', chatId)
    .eq('week', week)
    .eq('year', year);

  if (filter === 'today') {
    query = query.eq('day', day).eq('done', false);
  }
  else if (filter === 'all') {
    query = query.eq('day', day);
  }
  // 'week' — все задачи недели

  const { data: tasks, error } = await query;

  if (error) {
    console.error('Tasks error:', error);
    await sendMessage(chatId, '❌ Ошибка при получении задач');
    return;
  }

  if (!tasks || tasks.length === 0) {
    await sendMessage(chatId, '📋 <b>Задачи</b>\n\nНет задач на сегодня.\n\nОткрой ежедневник и добавь!');
    return;
  }

  const doneCount = tasks.filter(t => t.done).length;
  const list = tasks.map(t => `${t.done ? '✅' : '⬜'} ${t.text}`).join('\n');

  const titles = {
    today: 'Задачи на сегодня',
    all: 'Все задачи на сегодня',
    week: 'Задачи на неделю'
  };

  await sendMessage(chatId,
    `📋 <b>${titles[filter]}</b>\n\n${list}\n\n` +
    `✅ ${doneCount}/${tasks.length} выполнено`
  );
}

async function handleWeek(chatId) {
  const now = new Date();
  const week = getWeekNumber(now);
  const year = now.getFullYear();

  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('telegram_id', chatId)
    .eq('week', week)
    .eq('year', year);

  const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  let msg = `📅 <b>Неделя ${week}</b>\n\n`;

  for (let d = 0; d < 7; d++) {
    const dayTasks = (tasks || []).filter(t => t.day === d);
    const done = dayTasks.filter(t => t.done).length;
    const total = dayTasks.length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    const bar = '█'.repeat(Math.round(percent / 10)) + '░'.repeat(10 - Math.round(percent / 10));
    
    msg += `${dayNames[d]} ${bar} ${percent}%\n`;
    if (total > 0) {
      dayTasks.slice(0, 3).forEach(t => {
        msg += `  ${t.done ? '✅' : '⬜'} ${t.text}\n`;
      });
      if (dayTasks.length > 3) msg += `  ...и ещё ${dayTasks.length - 3}\n`;
    }
    msg += '\n';
  }

  await sendMessage(chatId, msg);
}

async function handleJournal(chatId) {
  const today = new Date().toISOString().split('T')[0];

  const { data: entry } = await supabase
    .from('journal')
    .select('*')
    .eq('telegram_id', chatId)
    .eq('date', today)
    .single();

  if (!entry) {
    await sendMessage(chatId, '📝 <b>Дневник сегодня</b>\n\nЗаписей пока нет.\n\nОткрой ежедневник и заполни!');
    return;
  }

  await sendMessage(chatId,
    `📝 <b>Дневник — ${today}</b>\n\n` +
    `😴 Сон: ${entry.sleep || '-'} ч\n` +
    `⚡ Энергия: ${entry.energy || '-'}/10\n` +
    `😊 Настроение: ${entry.mood || '-'}/10\n\n` +
    `💡 Урок: ${entry.lesson || '—'}\n` +
    `🙏 Благодарность: ${entry.gratitude || '—'}\n` +
    `📝 Заметки: ${entry.notes || '—'}`
  );
}

async function handleProgress(chatId) {
  const now = new Date();
  const week = getWeekNumber(now);
  const year = now.getFullYear();

  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('telegram_id', chatId)
    .eq('week', week)
    .eq('year', year);

  const total = (tasks || []).length;
  const done = (tasks || []).filter(t => t.done).length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  await sendMessage(chatId,
    `📊 <b>Прогресс недели</b>\n\n` +
    `✅ ${done} из ${total} задач\n` +
    `📈 ${percent}%\n\n` +
    `${percent >= 80 ? '🎉 Отличный результат!' : percent >= 50 ? '💪 Хороший прогресс!' : '🚀 Вперёд, ты справишься!'}`
  );
}

async function handleStats(chatId) {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('telegram_id', chatId);

  const { data: journal } = await supabase
    .from('journal')
    .select('*')
    .eq('telegram_id', chatId);

  const total = (tasks || []).length;
  const done = (tasks || []).filter(t => t.done).length;
  const rate = total > 0 ? Math.round((done / total) * 100) : 0;

  const sleeps = (journal || []).filter(j => j.sleep).map(j => j.sleep);
  const avgSleep = sleeps.length > 0 ? (sleeps.reduce((a, b) => a + b, 0) / sleeps.length).toFixed(1) : '-';

  const energies = (journal || []).filter(j => j.energy).map(j => j.energy);
  const avgEnergy = energies.length > 0 ? (energies.reduce((a, b) => a + b, 0) / energies.length).toFixed(1) : '-';

  await sendMessage(chatId,
    `📊 <b>Статистика</b>\n\n` +
    `📋 Всего задач: ${total}\n` +
    `✅ Выполнено: ${done} (${rate}%)\n` +
    `😴 Средний сон: ${avgSleep} ч\n` +
    `⚡ Средняя энергия: ${avgEnergy}/10\n` +
    `📝 Записей в дневнике: ${(journal || []).length}`
  );
}

async function handleSettings(chatId) {
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', chatId)
    .single();

  const morning = user?.notify_morning || '08:00';
  const evening = user?.notify_evening || '21:00';

  await sendMessage(chatId,
    `⚙️ <b>Настройки</b>\n\n` +
    `🌅 Утренние уведомления: ${morning}\n` +
    `🌙 Вечерние уведомления: ${evening}\n\n` +
    `Изменить:\n` +
    `/setmorning HH:MM — утро\n` +
    `/setevening HH:MM — вечер\n\n` +
    `Пример: /setmorning 07:30`
  );
}

async function setNotifyTime(chatId, type, time) {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    await sendMessage(chatId, '❌ Неверный формат. Используй HH:MM, например 08:00');
    return;
  }

  const field = type === 'morning' ? 'notify_morning' : 'notify_evening';
  await supabase
    .from('users')
    .update({ [field]: time })
    .eq('telegram_id', chatId);

  await sendMessage(chatId, `✅ ${type === 'morning' ? '🌅 Утренние' : '🌙 Вечерние'} уведомления установлены на ${time}`);
}

async function handleHelp(chatId) {
  await sendMessage(chatId,
    `🦝 <b>Енотов Ежедневник — Справка</b>\n\n` +
    `<b>Команды:</b>\n` +
    `/tasks — активные задачи на сегодня\n` +
    `/tasks all — все задачи на сегодня\n` +
    `/tasks week — задачи на неделю\n` +
    `/week — обзор недели с прогрессом\n` +
    `/journal — статус дневника\n` +
    `/progress — прогресс недели (%)\n` +
    `/stats — полная статистика\n` +
    `/settings — настройки уведомлений\n` +
    `/myid — узнать свой ID\n` +
    `/help — эта справка\n\n` +
    `<b>Кнопка «Ежедневник»:</b>\n` +
    `Открывает полноценное приложение для планирования\n\n` +
    `<b>Свободные сообщения:</b>\n` +
    `«задачи», «дела», «что сегодня» → список задач\n` +
    `«дневник» → статус дневника\n` +
    `«прогресс», «статистика» → прогресс недели`
  );
}

async function handleFreeText(chatId, text) {
  const lower = text.toLowerCase();
  
  if (lower.includes('задач') || lower.includes('дел') || lower.includes('сегодня')) {
    await handleTasks(chatId, 'today');
  }
  else if (lower.includes('дневник')) {
    await handleJournal(chatId);
  }
  else if (lower.includes('прогресс') || lower.includes('статистик')) {
    await handleProgress(chatId);
  }
  else {
    await sendMessage(chatId,
      `🦝 Я понимаю команды и ключевые слова:\n\n` +
      `• «задачи», «дела» — список задач\n` +
      `• «дневник» — статус дневника\n` +
      `• «прогресс» — статистика\n\n` +
      `Полный список: /help`
    );
  }
}

// ===== CRON УВЕДОМЛЕНИЯ =====
// Вызывать каждую минуту через cron на Render
app.get('/cron', async (req, res) => {
  const now = new Date();
  const timeStr = now.toTimeString().slice(0, 5); // HH:MM
  const day = now.getDay();
  const week = getWeekNumber(now);
  const year = now.getFullYear();

  // Утренние уведомления
  const { data: morningUsers } = await supabase
    .from('users')
    .select('*')
    .eq('notify_morning', timeStr);

  for (const u of morningUsers || []) {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('telegram_id', u.telegram_id)
      .eq('week', week)
      .eq('year', year)
      .eq('day', day)
      .eq('done', false);

    const list = (tasks || []).map(t => `⬜ ${t.text}`).join('\n') || 'Нет задач на сегодня';

    await sendMessage(u.telegram_id,
      `🌅 <b>Доброе утро, ${u.first_name || 'друг'}!</b>\n\n` +
      `📋 Задачи на сегодня:\n${list}`
    );
  }

  // Вечерние уведомления
  const { data: eveningUsers } = await supabase
    .from('users')
    .select('*')
    .eq('notify_evening', timeStr);

  for (const u of eveningUsers || []) {
    await sendMessage(u.telegram_id,
      `🌙 <b>Добрый вечер, ${u.first_name || 'друг'}!</b>\n\n` +
      `Не забудь заполнить дневник в ежедневнике 📝`
    );
  }

  res.json({ sent: (morningUsers?.length || 0) + (eveningUsers?.length || 0) });
});

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.json({ status: 'ok', bot: 'Raccoon Diary', time: new Date().toISOString() });
});

// ===== HELPERS =====
function getWeekNumber(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// ===== START =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🦝 Raccoon Bot running on port ${PORT}`);
});
