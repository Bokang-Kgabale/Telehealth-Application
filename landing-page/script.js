// Add animation to show content when page loads
document.addEventListener('DOMContentLoaded', () => {
    const contentBox = document.querySelector('.content-box');
    
    // Set initial state
    contentBox.style.opacity = 0;
    
    // Trigger fade-in animation after a short delay
    setTimeout(() => {
      contentBox.style.opacity = 1;
      contentBox.style.transition = 'opacity 0.8s ease-in-out';
    }, 200);
    
    // Add ripple effect to buttons
    const buttons = document.querySelectorAll('.btn');
    
    buttons.forEach(button => {
      button.addEventListener('mousedown', function(e) {
        const x = e.clientX - this.getBoundingClientRect().left;
        const y = e.clientY - this.getBoundingClientRect().top;
        
        const ripple = document.createElement('span');
        ripple.classList.add('ripple');
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        
        this.appendChild(ripple);
        
        setTimeout(() => {
          ripple.remove();
        }, 600);
      });
    });
  });