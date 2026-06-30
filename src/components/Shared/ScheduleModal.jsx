import React, { useState, useEffect } from "react";
import { X, ChevronLeft, ChevronRight, Clock, Calendar as CalendarIcon } from "lucide-react";

export default function ScheduleModal({ generation, onClose, onSave }) {
  // Date State
  const today = new Date();
  const [currentDate, setCurrentDate] = useState(today); // For navigating months
  const [selectedDate, setSelectedDate] = useState(today); // The actual selected day
  
  // Time State
  const [time, setTime] = useState({ hours: "12", minutes: "00" });

  // --- Calendar Logic ---
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay(); // 0 = Sunday

  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleDayClick = (day) => {
    const newDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    setSelectedDate(newDate);
  };

  const handleSave = () => {
    // Combine Date + Time into ISO String
    const scheduledDateTime = new Date(selectedDate);
    scheduledDateTime.setHours(parseInt(time.hours), parseInt(time.minutes));
    
    // Pass back to parent
    onSave(scheduledDateTime.toISOString());
  };

  // Generate Day Grid
  const renderCalendarDays = () => {
    const days = [];
    // Empty slots for days before the 1st
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(<div key={`empty-${i}`} className="calendar-day empty"></div>);
    }
    // Actual days
    for (let d = 1; d <= daysInMonth; d++) {
      const isSelected = 
        selectedDate.getDate() === d && 
        selectedDate.getMonth() === currentDate.getMonth() && 
        selectedDate.getFullYear() === currentDate.getFullYear();
        
      const isToday = 
        today.getDate() === d && 
        today.getMonth() === currentDate.getMonth() && 
        today.getFullYear() === currentDate.getFullYear();

      days.push(
        <button 
          key={d} 
          onClick={() => handleDayClick(d)}
          className={`calendar-day ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}`}
        >
          {d}
        </button>
      );
    }
    return days;
  };

  return (
    <div className="studio-overlay">
      <div className="schedule-modal-container">
        
        {/* Header */}
        <div className="modal-header">
          <h3>Schedule Post</h3>
          <button onClick={onClose} className="close-btn"><X size={18} /></button>
        </div>

        <div className="modal-body">
          
          {/* LEFT: CALENDAR */}
          <div className="calendar-section">
            <div className="calendar-nav">
              <span className="month-label">
                {months[currentDate.getMonth()]} {currentDate.getFullYear()}
              </span>
              <div className="nav-arrows">
                <button onClick={handlePrevMonth}><ChevronLeft size={16} /></button>
                <button onClick={handleNextMonth}><ChevronRight size={16} /></button>
              </div>
            </div>

            <div className="weekdays-grid">
              <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
            </div>

            <div className="days-grid">
              {renderCalendarDays()}
            </div>
          </div>

          {/* RIGHT: TIME & PREVIEW */}
          <div className="time-section">
            
            <div className="section-label-row">
              <Clock size={14} />
              <span>Set Time</span>
            </div>

            <div className="time-picker-box">
              <div className="time-input-group">
                <input 
                  type="number" 
                  min="0" max="23" 
                  value={time.hours} 
                  onChange={(e) => setTime({...time, hours: e.target.value})} 
                  className="time-input"
                />
                <span className="time-colon">:</span>
                <input 
                  type="number" 
                  min="0" max="59" 
                  value={time.minutes} 
                  onChange={(e) => setTime({...time, minutes: e.target.value})} 
                  className="time-input"
                />
              </div>
            </div>

            <div className="selected-summary">
              <CalendarIcon size={14} />
              <p>
                {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                <br />
                <span className="highlight-time">at {time.hours}:{time.minutes.padStart(2, '0')}</span>
              </p>
            </div>

            <button className="confirm-schedule-btn" onClick={handleSave}>
              Confirm Schedule
            </button>

          </div>
        </div>
      </div>
    </div>
  );
}