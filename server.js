// server.js - Calendar API для Protalk
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// API токен (измените на свой!)
const API_TOKEN = process.env.API_TOKEN || 'calendar_secret_token_12345';

// Middleware для проверки токена
function checkAuth(req, res, next) {
  // Проверяем токен в заголовке или в параметрах
  const token = req.headers['authorization']?.replace('Bearer ', '') || 
                req.query.token || 
                req.body?.token;
  
  // Пропускаем проверку для главной страницы и health
  if (req.path === '/' || req.path === '/health') {
    return next();
  }
  
  if (token !== API_TOKEN) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized. Invalid or missing API token.'
    });
  }
  
  next();
}

// Применяем проверку токена ко всем запросам
app.use(checkAuth);

// Хранилище выборов пользователей (в памяти)
const userSelections = new Map();

// Названия месяцев
const monthNames = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

// Функция для генерации календаря
function generateCalendar(year, month) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();
  
  // День недели первого дня (0 = воскресенье, нужно конвертировать в понедельник = 0)
  let startDay = firstDay.getDay() - 1;
  if (startDay === -1) startDay = 6;
  
  const calendar = [];
  let week = [];
  
  // Пустые ячейки до первого дня
  for (let i = 0; i < startDay; i++) {
    week.push(0);
  }
  
  // Дни месяца
  for (let day = 1; day <= daysInMonth; day++) {
    week.push(day);
    
    if (week.length === 7) {
      calendar.push(week);
      week = [];
    }
  }
  
  // Дополняем последнюю неделю
  if (week.length > 0) {
    while (week.length < 7) {
      week.push(0);
    }
    calendar.push(week);
  }
  
  return calendar;
}

// Главная страница с документацией
app.get('/', (req, res) => {
  res.json({
    service: 'Calendar API для Protalk',
    version: '1.0.0',
    documentation: 'https://github.com/yourusername/calendar-api',
    endpoints: {
      'GET /api/calendar': 'Получить JSON календаря для Protalk',
      'GET /api/calendar/keyboard': 'Получить структуру inline-клавиатуры',
      'POST /api/select': 'Сохранить выбранную дату',
      'GET /api/selection/:userId': 'Получить выбор пользователя',
      'DELETE /api/selection/:userId': 'Очистить выбор',
      'GET /health': 'Проверка работоспособности'
    },
    examples: {
      calendar: '/api/calendar?year=2024&month=11&mode=single',
      keyboard: '/api/calendar/keyboard?year=2024&month=11&userId=123&mode=single'
    }
  });
});

// API для получения данных календаря (JSON)
app.get('/api/calendar', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const mode = req.query.mode || 'single';
    
    const calendar = generateCalendar(year, month);
    
    res.json({
      success: true,
      year,
      month,
      monthName: monthNames[month - 1],
      mode,
      calendar,
      metadata: {
        firstDayOfWeek: 1, // Понедельник
        daysInMonth: calendar.flat().filter(d => d > 0).length
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// API для генерации inline-клавиатуры в формате Telegram
app.get('/api/calendar/keyboard', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const userId = req.query.userId;
    const mode = req.query.mode || 'single';
    
    const calendar = generateCalendar(year, month);
    const keyboard = [];
    
    // Заголовок с навигацией
    keyboard.push([
      { text: '◀️', callback_data: `prev_${year}_${month}` },
      { text: `${monthNames[month - 1]} ${year}`, callback_data: 'ignore' },
      { text: '▶️', callback_data: `next_${year}_${month}` }
    ]);
    
    // Дни недели
    const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    keyboard.push(weekDays.map(day => ({
      text: day,
      callback_data: 'ignore'
    })));
    
    // Дни месяца
    calendar.forEach(week => {
      const row = week.map(day => {
        if (day === 0) {
          return { text: ' ', callback_data: 'ignore' };
        }
        return {
          text: day.toString(),
          callback_data: `day_${year}_${month}_${day}_${userId || 'guest'}`
        };
      });
      keyboard.push(row);
    });
    
    // Переключатель режима
    keyboard.push([
      {
        text: mode === 'single' ? '✅ Одна дата' : '📅 Одна дата',
        callback_data: `mode_single_${year}_${month}_${userId || 'guest'}`
      },
      {
        text: mode === 'range' ? '✅ Период' : '📆 Период',
        callback_data: `mode_range_${year}_${month}_${userId || 'guest'}`
      }
    ]);
    
    res.json({
      success: true,
      inline_keyboard: keyboard,
      year,
      month,
      mode
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Сохранение выбранной даты
app.post('/api/select', (req, res) => {
  try {
    const { userId, year, month, day, mode } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }
    
    const selectedDate = new Date(year, month - 1, day);
    const dateStr = selectedDate.toISOString().split('T')[0];
    
    // Получаем текущий выбор пользователя
    let selection = userSelections.get(userId) || { mode, dates: [] };
    
    if (mode === 'single') {
      selection = { mode: 'single', dates: [dateStr] };
      userSelections.set(userId, selection);
      
      res.json({
        success: true,
        mode: 'single',
        date: dateStr,
        formatted: formatDate(selectedDate),
        message: `Выбрана дата: ${formatDate(selectedDate)}`
      });
      
    } else if (mode === 'range') {
      if (selection.dates.length === 0) {
        // Первая дата
        selection = { mode: 'range', dates: [dateStr] };
        userSelections.set(userId, selection);
        
        res.json({
          success: true,
          mode: 'range',
          status: 'start_selected',
          startDate: dateStr,
          message: 'Выберите конечную дату периода'
        });
        
      } else if (selection.dates.length === 1) {
        // Вторая дата
        const dates = [
          new Date(selection.dates[0]),
          selectedDate
        ].sort((a, b) => a - b);
        
        const startDate = dates[0].toISOString().split('T')[0];
        const endDate = dates[1].toISOString().split('T')[0];
        const daysCount = Math.ceil((dates[1] - dates[0]) / (1000 * 60 * 60 * 24)) + 1;
        
        selection = { mode: 'range', dates: [startDate, endDate] };
        userSelections.set(userId, selection);
        
        res.json({
          success: true,
          mode: 'range',
          status: 'complete',
          startDate,
          endDate,
          daysCount,
          formatted: `${formatDate(dates[0])} - ${formatDate(dates[1])}`,
          message: `Выбран период: ${formatDate(dates[0])} - ${formatDate(dates[1])} (${daysCount} дн.)`
        });
        
      } else {
        // Начать новый выбор
        selection = { mode: 'range', dates: [dateStr] };
        userSelections.set(userId, selection);
        
        res.json({
          success: true,
          mode: 'range',
          status: 'start_selected',
          startDate: dateStr,
          message: 'Выберите конечную дату периода'
        });
      }
    }
    
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Получить выбор пользователя
app.get('/api/selection/:userId', (req, res) => {
  const { userId } = req.params;
  const selection = userSelections.get(userId);
  
  if (selection) {
    res.json({
      success: true,
      hasSelection: true,
      mode: selection.mode,
      dates: selection.dates,
      formatted: selection.dates.length === 1
        ? formatDate(new Date(selection.dates[0]))
        : `${formatDate(new Date(selection.dates[0]))} - ${formatDate(new Date(selection.dates[1]))}`
    });
  } else {
    res.json({
      success: true,
      hasSelection: false,
      message: 'Нет активного выбора'
    });
  }
});

// Очистить выбор
app.delete('/api/selection/:userId', (req, res) => {
  const { userId } = req.params;
  
  if (userSelections.has(userId)) {
    userSelections.delete(userId);
    res.json({
      success: true,
      message: 'Выбор очищен'
    });
  } else {
    res.json({
      success: true,
      message: 'Нет активного выбора'
    });
  }
});

// Навигация по месяцам
app.get('/api/navigate', (req, res) => {
  try {
    let year = parseInt(req.query.year);
    let month = parseInt(req.query.month);
    const direction = req.query.direction;
    
    if (direction === 'next') {
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    } else if (direction === 'prev') {
      month--;
      if (month < 1) {
        month = 12;
        year--;
      }
    }
    
    res.json({
      success: true,
      year,
      month,
      monthName: monthNames[month - 1]
    });
    
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Webhook для Protalk - обработка callback
app.post('/api/webhook/protalk', (req, res) => {
  try {
    const { callback_data, user_id } = req.body;
    const parts = callback_data.split('_');
    const action = parts[0];
    
    let response = {};
    
    if (action === 'day') {
      // Выбор дня: day_2024_11_10_userId
      const year = parseInt(parts[1]);
      const month = parseInt(parts[2]);
      const day = parseInt(parts[3]);
      const userId = parts[4] || user_id;
      
      // Получаем режим пользователя
      const selection = userSelections.get(userId) || { mode: 'single', dates: [] };
      
      // Делаем запрос на выбор
      // (здесь можно вызвать внутреннюю функцию или эндпоинт)
      
      response = {
        action: 'select_date',
        year,
        month,
        day,
        userId,
        mode: selection.mode
      };
      
    } else if (action === 'next' || action === 'prev') {
      // Навигация: next_2024_11 или prev_2024_11
      const year = parseInt(parts[1]);
      const month = parseInt(parts[2]);
      
      response = {
        action: 'navigate',
        direction: action,
        year,
        month
      };
      
    } else if (action === 'mode') {
      // Смена режима: mode_single_2024_11_userId
      const mode = parts[1];
      const year = parseInt(parts[2]);
      const month = parseInt(parts[3]);
      const userId = parts[4] || user_id;
      
      // Очищаем выбор при смене режима
      if (userId) {
        userSelections.delete(userId);
      }
      
      response = {
        action: 'change_mode',
        mode,
        year,
        month,
        userId
      };
    }
    
    res.json({
      success: true,
      callback_data,
      parsed: response
    });
    
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint для Protalk (формат ##INLINE...##)
app.get('/api/calendar/protalk', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const userId = req.query.userId || 'guest';
    const mode = req.query.mode || 'single';
    
    const calendar = generateCalendar(year, month);
    
    // Формируем inline-кнопки в формате Protalk
    let inlineButtons = [];
    
    // Заголовок с навигацией
    inlineButtons.push(`◀️::prev_${year}_${month}`, `${monthNames[month - 1]} ${year}::ignore`, `▶️::next_${year}_${month}`);
    inlineButtons.push('---'); // Разделитель строк
    
    // Дни недели
    const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    weekDays.forEach(day => inlineButtons.push(`${day}::ignore`));
    inlineButtons.push('---');
    
    // Дни месяца
    calendar.forEach(week => {
      week.forEach(day => {
        if (day === 0) {
          inlineButtons.push(' ::ignore');
        } else {
          inlineButtons.push(`${day}::day_${year}_${month}_${day}_${userId}`);
        }
      });
      inlineButtons.push('---');
    });
    
    // Кнопки режима
    const singleBtn = mode === 'single' ? '✅ Одна дата' : '📅 Одна дата';
    const rangeBtn = mode === 'range' ? '✅ Период' : '📆 Период';
    inlineButtons.push(`${singleBtn}::mode_single_${year}_${month}_${userId}`, `${rangeBtn}::mode_range_${year}_${month}_${userId}`);
    
    // Убираем последний разделитель
    if (inlineButtons[inlineButtons.length - 1] === '---') {
      inlineButtons.pop();
    }
    
    const protalkFormat = `##INLINE:${inlineButtons.join('|')}##`;
    
    res.json({
      success: true,
      protalk_format: protalkFormat,
      text: `Выберите дату (${monthNames[month - 1]} ${year})`,
      year,
      month,
      mode
    });
    
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Проверка здоровья
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Calendar API',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Функция форматирования даты
function formatDate(date) {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Calendar API запущен на порту ${PORT}`);
  console.log(`📖 Документация: http://localhost:${PORT}/`);
  console.log(`❤️  Здоровье: http://localhost:${PORT}/health`);
});

module.exports = app;// server.js - Calendar API для Protalk
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Хранилище выборов пользователей (в памяти)
const userSelections = new Map();

// Названия месяцев
const monthNames = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

// Функция для генерации календаря
function generateCalendar(year, month) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();
  
  // День недели первого дня (0 = воскресенье, нужно конвертировать в понедельник = 0)
  let startDay = firstDay.getDay() - 1;
  if (startDay === -1) startDay = 6;
  
  const calendar = [];
  let week = [];
  
  // Пустые ячейки до первого дня
  for (let i = 0; i < startDay; i++) {
    week.push(0);
  }
  
  // Дни месяца
  for (let day = 1; day <= daysInMonth; day++) {
    week.push(day);
    
    if (week.length === 7) {
      calendar.push(week);
      week = [];
    }
  }
  
  // Дополняем последнюю неделю
  if (week.length > 0) {
    while (week.length < 7) {
      week.push(0);
    }
    calendar.push(week);
  }
  
  return calendar;
}

// Главная страница с документацией
app.get('/', (req, res) => {
  res.json({
    service: 'Calendar API для Protalk',
    version: '1.0.0',
    documentation: 'https://github.com/yourusername/calendar-api',
    endpoints: {
      'GET /api/calendar': 'Получить JSON календаря для Protalk',
      'GET /api/calendar/keyboard': 'Получить структуру inline-клавиатуры',
      'POST /api/select': 'Сохранить выбранную дату',
      'GET /api/selection/:userId': 'Получить выбор пользователя',
      'DELETE /api/selection/:userId': 'Очистить выбор',
      'GET /health': 'Проверка работоспособности'
    },
    examples: {
      calendar: '/api/calendar?year=2024&month=11&mode=single',
      keyboard: '/api/calendar/keyboard?year=2024&month=11&userId=123&mode=single'
    }
  });
});

// API для получения данных календаря (JSON)
app.get('/api/calendar', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const mode = req.query.mode || 'single';
    
    const calendar = generateCalendar(year, month);
    
    res.json({
      success: true,
      year,
      month,
      monthName: monthNames[month - 1],
      mode,
      calendar,
      metadata: {
        firstDayOfWeek: 1, // Понедельник
        daysInMonth: calendar.flat().filter(d => d > 0).length
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// API для генерации inline-клавиатуры в формате Telegram
app.get('/api/calendar/keyboard', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const userId = req.query.userId;
    const mode = req.query.mode || 'single';
    
    const calendar = generateCalendar(year, month);
    const keyboard = [];
    
    // Заголовок с навигацией
    keyboard.push([
      { text: '◀️', callback_data: `prev_${year}_${month}` },
      { text: `${monthNames[month - 1]} ${year}`, callback_data: 'ignore' },
      { text: '▶️', callback_data: `next_${year}_${month}` }
    ]);
    
    // Дни недели
    const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    keyboard.push(weekDays.map(day => ({
      text: day,
      callback_data: 'ignore'
    })));
    
    // Дни месяца
    calendar.forEach(week => {
      const row = week.map(day => {
        if (day === 0) {
          return { text: ' ', callback_data: 'ignore' };
        }
        return {
          text: day.toString(),
          callback_data: `day_${year}_${month}_${day}_${userId || 'guest'}`
        };
      });
      keyboard.push(row);
    });
    
    // Переключатель режима
    keyboard.push([
      {
        text: mode === 'single' ? '✅ Одна дата' : '📅 Одна дата',
        callback_data: `mode_single_${year}_${month}_${userId || 'guest'}`
      },
      {
        text: mode === 'range' ? '✅ Период' : '📆 Период',
        callback_data: `mode_range_${year}_${month}_${userId || 'guest'}`
      }
    ]);
    
    res.json({
      success: true,
      inline_keyboard: keyboard,
      year,
      month,
      mode
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Сохранение выбранной даты
app.post('/api/select', (req, res) => {
  try {
    const { userId, year, month, day, mode } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }
    
    const selectedDate = new Date(year, month - 1, day);
    const dateStr = selectedDate.toISOString().split('T')[0];
    
    // Получаем текущий выбор пользователя
    let selection = userSelections.get(userId) || { mode, dates: [] };
    
    if (mode === 'single') {
      selection = { mode: 'single', dates: [dateStr] };
      userSelections.set(userId, selection);
      
      res.json({
        success: true,
        mode: 'single',
        date: dateStr,
        formatted: formatDate(selectedDate),
        message: `Выбрана дата: ${formatDate(selectedDate)}`
      });
      
    } else if (mode === 'range') {
      if (selection.dates.length === 0) {
        // Первая дата
        selection = { mode: 'range', dates: [dateStr] };
        userSelections.set(userId, selection);
        
        res.json({
          success: true,
          mode: 'range',
          status: 'start_selected',
          startDate: dateStr,
          message: 'Выберите конечную дату периода'
        });
        
      } else if (selection.dates.length === 1) {
        // Вторая дата
        const dates = [
          new Date(selection.dates[0]),
          selectedDate
        ].sort((a, b) => a - b);
        
        const startDate = dates[0].toISOString().split('T')[0];
        const endDate = dates[1].toISOString().split('T')[0];
        const daysCount = Math.ceil((dates[1] - dates[0]) / (1000 * 60 * 60 * 24)) + 1;
        
        selection = { mode: 'range', dates: [startDate, endDate] };
        userSelections.set(userId, selection);
        
        res.json({
          success: true,
          mode: 'range',
          status: 'complete',
          startDate,
          endDate,
          daysCount,
          formatted: `${formatDate(dates[0])} - ${formatDate(dates[1])}`,
          message: `Выбран период: ${formatDate(dates[0])} - ${formatDate(dates[1])} (${daysCount} дн.)`
        });
        
      } else {
        // Начать новый выбор
        selection = { mode: 'range', dates: [dateStr] };
        userSelections.set(userId, selection);
        
        res.json({
          success: true,
          mode: 'range',
          status: 'start_selected',
          startDate: dateStr,
          message: 'Выберите конечную дату периода'
        });
      }
    }
    
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Получить выбор пользователя
app.get('/api/selection/:userId', (req, res) => {
  const { userId } = req.params;
  const selection = userSelections.get(userId);
  
  if (selection) {
    res.json({
      success: true,
      hasSelection: true,
      mode: selection.mode,
      dates: selection.dates,
      formatted: selection.dates.length === 1
        ? formatDate(new Date(selection.dates[0]))
        : `${formatDate(new Date(selection.dates[0]))} - ${formatDate(new Date(selection.dates[1]))}`
    });
  } else {
    res.json({
      success: true,
      hasSelection: false,
      message: 'Нет активного выбора'
    });
  }
});

// Очистить выбор
app.delete('/api/selection/:userId', (req, res) => {
  const { userId } = req.params;
  
  if (userSelections.has(userId)) {
    userSelections.delete(userId);
    res.json({
      success: true,
      message: 'Выбор очищен'
    });
  } else {
    res.json({
      success: true,
      message: 'Нет активного выбора'
    });
  }
});

// Навигация по месяцам
app.get('/api/navigate', (req, res) => {
  try {
    let year = parseInt(req.query.year);
    let month = parseInt(req.query.month);
    const direction = req.query.direction;
    
    if (direction === 'next') {
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    } else if (direction === 'prev') {
      month--;
      if (month < 1) {
        month = 12;
        year--;
      }
    }
    
    res.json({
      success: true,
      year,
      month,
      monthName: monthNames[month - 1]
    });
    
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Webhook для Protalk - обработка callback
app.post('/api/webhook/protalk', (req, res) => {
  try {
    const { callback_data, user_id } = req.body;
    const parts = callback_data.split('_');
    const action = parts[0];
    
    let response = {};
    
    if (action === 'day') {
      // Выбор дня: day_2024_11_10_userId
      const year = parseInt(parts[1]);
      const month = parseInt(parts[2]);
      const day = parseInt(parts[3]);
      const userId = parts[4] || user_id;
      
      // Получаем режим пользователя
      const selection = userSelections.get(userId) || { mode: 'single', dates: [] };
      
      // Делаем запрос на выбор
      // (здесь можно вызвать внутреннюю функцию или эндпоинт)
      
      response = {
        action: 'select_date',
        year,
        month,
        day,
        userId,
        mode: selection.mode
      };
      
    } else if (action === 'next' || action === 'prev') {
      // Навигация: next_2024_11 или prev_2024_11
      const year = parseInt(parts[1]);
      const month = parseInt(parts[2]);
      
      response = {
        action: 'navigate',
        direction: action,
        year,
        month
      };
      
    } else if (action === 'mode') {
      // Смена режима: mode_single_2024_11_userId
      const mode = parts[1];
      const year = parseInt(parts[2]);
      const month = parseInt(parts[3]);
      const userId = parts[4] || user_id;
      
      // Очищаем выбор при смене режима
      if (userId) {
        userSelections.delete(userId);
      }
      
      response = {
        action: 'change_mode',
        mode,
        year,
        month,
        userId
      };
    }
    
    res.json({
      success: true,
      callback_data,
      parsed: response
    });
    
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Проверка здоровья
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Calendar API',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Функция форматирования даты
function formatDate(date) {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Calendar API запущен на порту ${PORT}`);
  console.log(`📖 Документация: http://localhost:${PORT}/`);
  console.log(`❤️  Здоровье: http://localhost:${PORT}/health`);
});

module.exports = app;
