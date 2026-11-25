# AlphaTerm: shell integration for bash (Git Bash on Windows, bash on Linux). Loaded with --init-file.
# Emits OSC 133 (prompt/command/end with code), OSC 633;E (command text) and OSC 7 (folder).
if [ -z "$__NT_INIT" ]; then
  __NT_INIT=1
  if [ -n "$MSYSTEM" ]; then
    # Git Bash: --init-file isn't a login shell, so what --login would load is loaded by hand.
    [ -r /etc/profile ] && . /etc/profile
    if [ -r ~/.bash_profile ]; then . ~/.bash_profile
    elif [ -r ~/.bash_login ]; then . ~/.bash_login
    elif [ -r ~/.profile ]; then . ~/.profile
    elif [ -r ~/.bashrc ]; then . ~/.bashrc
    fi
  else
    # Linux: like any terminal, an interactive non-login shell (--init-file replaces ~/.bashrc).
    [ -r /etc/bash.bashrc ] && . /etc/bash.bashrc
    [ -r ~/.bashrc ] && . ~/.bashrc
  fi
fi

__nt_esc() {
  local s=${1//\\/\\\\}
  s=${s//;/\\x3b}
  s=${s//$'\n'/\\x0a}
  printf '%s' "$s"
}

# PS0 se expande después de leer un comando y antes de ejecutarlo. El subíndice aritmético
# marca __nt_started en el shell actual; la sustitución imprime el comando y el inicio.
__nt_ps0() {
  local cmd
  cmd=$(HISTTIMEFORMAT= builtin history 1 | sed 's/^ *[0-9]* *//')
  printf '\e]633;E;%s\a\e]133;C\a' "$(__nt_esc "$cmd")"
}
PS0='${__nt_arr[(__nt_started=1)]}$(__nt_ps0)'

__nt_precmd() {
  local ec=$?
  if [ -n "$__nt_started" ]; then printf '\e]133;D;%s\a' "$ec"; fi
  __nt_started=
  local dir
  dir=$(pwd -W 2>/dev/null || pwd)
  dir=${dir//%/%25}
  # Git Bash gives "C:/x" (needs the slash after the host); Linux, "/home/x".
  case "$dir" in /*) ;; *) dir="/$dir" ;; esac
  printf '\e]7;file://%s%s\a' "${HOSTNAME:-localhost}" "${dir// /%20}"
  return $ec
}

__nt_wrap_ps1() {
  case "$PS1" in
    *'133;A'*) ;;
    *) PS1='\[\e]133;A\a\]'"$PS1"'\[\e]133;B\a\]' ;;
  esac
}

PROMPT_COMMAND="__nt_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}; __nt_wrap_ps1"
